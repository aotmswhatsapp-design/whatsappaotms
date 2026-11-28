import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import type { AuthClaims } from "../auth/auth.types";
import { MediaStorage } from "../inbox/media.storage";
import { PrismaService } from "../prisma/prisma.service";
import { IMAGE_MIME } from "../templates/template-media";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { BotFlow, CardFileKind } from "./bot.card";
import { emptyFlow, flowProblem } from "./bot.flow";
import {
  cardFilePath,
  cardFolderFor,
  cardImagePath,
  ownedCardPath,
  prepareCardFile,
  prepareCardImage,
  storedFile,
} from "./bot.media";
import { flowIn } from "./bot.snapshot";
import { shiftCards, type ShiftMode, type ShiftRepairs } from "./bot.shift";
import { BotStore } from "./bot.store";

/** A flow plus whether anybody has written it down yet. */
export interface BotView {
  flow: BotFlow;
  stored: boolean;
}

/** What a shift answers with: this agent's flow, as it is stored now. */
export interface ShiftView {
  flow: BotFlow;
  /** Who received the cards, so the screen can name them in its message. */
  targetAgentId: string;
  /** What had to give way to keep both flows valid. */
  repairs: ShiftRepairs;
}

/** What the builder gets back once a picture is stored. */
export interface StoredCardImage {
  /** Permanent: Meta fetches this weeks later, when the card is shown. */
  url: string;
  path: string;
}

export interface UploadedCardImage extends StoredCardImage {
  width: number | null;
  height: number | null;
}

/** One stored document or video, as the card records it. */
export interface StoredCardFile extends StoredCardImage {
  /** The name the customer's phone shows on the download. */
  name: string;
  kind: CardFileKind;
}

/**
 * What one upload answers with.
 *
 * `type` rather than `kind`: the field has to tell "a picture" from "a file"
 * before it decides which arm of the card it belongs to, and `kind` is already
 * taken by a file's own document-or-video.
 */
export type UploadedCardMedia =
  | ({ type: "image" } & UploadedCardImage)
  | ({ type: "file" } & StoredCardFile);

/** Everything already uploaded for one agent, newest first. */
export interface CardMediaLibrary {
  images: (StoredCardImage & { updatedAt: string | null })[];
  files: (StoredCardFile & { updatedAt: string | null })[];
}

/** The parts of a multipart upload this feature reads. */
export interface UploadedBotImage {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/**
 * The one flow an agent owns.
 *
 * Reading is open to every member: the Inbox needs the cards to offer them, and
 * a card list is not a secret. Writing is the owner's, like every other field
 * that changes what a customer sees.
 *
 * Scoping goes through the agent row, not through the flow row: a flow whose
 * agent belongs to another workspace must look exactly like one that does not
 * exist, and the agent is the row that says whose it is.
 */
@Injectable()
export class BotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly store: BotStore,
    private readonly storage: MediaStorage,
  ) {}

  async read(claims: AuthClaims, agentId: string): Promise<BotView> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    await this.assertAgent(workspaceId, agentId);

    const flow = await this.guard(() => this.store.read(agentId));

    // The row is what says whose flow this is, not the id written inside the
    // document. The builder asks for this agent's picture gallery by the id it
    // gets back, so a stored flow naming another agent would list that agent's
    // uploads — and accept uploads into that agent's folder — under this name.
    return flow
      ? { flow: { ...flow, id: agentId }, stored: true }
      : { flow: emptyFlow(agentId), stored: false };
  }

  /**
   * Replaces the whole flow.
   *
   * Whole, not per card: a flow is one thing a customer walks through, and the
   * checks below (an entry card that exists, a button that points inside the
   * flow) are properties of the set. A per-card save could leave the flow
   * invalid between two clicks that both succeeded.
   */
  async save(
    claims: AuthClaims,
    agentId: string,
    dto: { flow?: unknown },
  ): Promise<BotView> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    await this.assertAgent(workspaceId, agentId);

    const read = flowIn(dto.flow);

    if (!read) {
      throw new BadRequestException({
        code: "BOT_FLOW_UNREADABLE",
        message: "That flow could not be read. Every card needs an id and every button an action.",
      });
    }

    // The flow belongs to the agent, so its id is the agent's however the
    // client numbered it: two ids for one flow is a drift nobody would notice.
    const flow: BotFlow = { ...read, id: agentId };
    const problem = flowProblem(flow);

    if (problem) {
      throw new BadRequestException({ code: "BOT_FLOW_INVALID", message: problem });
    }

    await this.guard(() => this.store.save(workspaceId, agentId, flow));

    return { flow, stored: true };
  }

  /**
   * Carries one or more cards from this agent's bot to another agent's.
   *
   * Two flows change, so this is not the screen saving one flow and then the
   * other: the target's flow is read here, at the moment of the shift, and the
   * browser never has to hold a copy of it that could be stale by the time it
   * was written back. The repairs are also decided next to the validation they
   * must satisfy, instead of in a second implementation on the client.
   *
   * The target is written first. A shift that dies halfway then leaves the card
   * in both flows — a copy the owner can delete — rather than in neither. The
   * pooler offers no interactive transaction, so two rows cannot be written as
   * one; the order is the whole guarantee there is.
   */
  async shift(
    claims: AuthClaims,
    agentId: string,
    dto: { targetAgentId: string; cardIds: string[]; mode: ShiftMode },
  ): Promise<ShiftView> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    await this.assertAgent(workspaceId, agentId);

    if (dto.targetAgentId === agentId) {
      throw new BadRequestException({
        code: "BOT_SHIFT_SAME_AGENT",
        message: "Those cards are already this agent's. Choose another agent.",
      });
    }

    // Checked against the same workspace, so an agent of somebody else's is
    // unknown here rather than a target that would take the cards.
    await this.assertAgent(workspaceId, dto.targetAgentId);

    const source = await this.guard(() => this.store.read(agentId));

    if (!source) {
      throw new BadRequestException({
        code: "BOT_FLOW_EMPTY",
        message:
          "This agent has no saved flow yet, so there is no card to shift. Save it first.",
      });
    }

    // A target nobody has written is an empty flow, not a refusal: shifting a
    // first card into a new agent is the ordinary way to split a bot.
    const target = await this.guard(() => this.store.read(dto.targetAgentId));

    const outcome = shiftCards({
      source: { ...source, id: agentId },
      target: target
        ? { ...target, id: dto.targetAgentId }
        : emptyFlow(dto.targetAgentId),
      cardIds: dto.cardIds,
      mode: dto.mode,
      newId: () => `card-${randomUUID().slice(0, 8)}`,
    });

    if (!outcome.ok) {
      throw new BadRequestException({
        code: "BOT_SHIFT_REFUSED",
        message: outcome.reason,
      });
    }

    // A shift only ever turns a card reference into a handoff or drops a rule,
    // so this should never fire. It is here because writing a flow the builder
    // cannot open again is worse than not writing it at all.
    const problem = flowProblem(outcome.target) ?? flowProblem(outcome.source);

    if (problem) {
      throw new BadRequestException({ code: "BOT_FLOW_INVALID", message: problem });
    }

    await this.guard(() =>
      this.store.save(workspaceId, dto.targetAgentId, outcome.target),
    );

    if (dto.mode === "move") {
      await this.guard(() => this.store.save(workspaceId, agentId, outcome.source));
    }

    return {
      flow: outcome.source,
      targetAgentId: dto.targetAgentId,
      repairs: outcome.repairs,
    };
  }

  /**
   * One uploaded picture or file in, one permanent address out.
   *
   * The bucket is public on purpose: this URL is written into the flow and
   * fetched by Meta when the customer is shown the card, which is often long
   * after the upload — a signed link would be dead by then.
   *
   * Which arm it takes is decided by the type the browser declared. A picture
   * is re-encoded (rotated, resized, EXIF stripped); a document is kept byte
   * for byte, because re-writing a `.docx` produces a file nobody can open.
   */
  async uploadMedia(
    claims: AuthClaims,
    agentId: string,
    file: UploadedBotImage | undefined,
  ): Promise<UploadedCardMedia> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    await this.assertAgent(workspaceId, agentId);

    if (!file?.buffer.length) {
      throw new BadRequestException("Choose a picture or a file to upload.");
    }

    if ((IMAGE_MIME as readonly string[]).includes(file.mimetype)) {
      const prepared = await prepareCardImage(file.buffer);

      if (!prepared.ok) {
        throw new BadRequestException({
          code: "BOT_IMAGE_INVALID",
          message: [prepared.reason],
        });
      }

      const path = cardImagePath({ workspaceId, agentId });

      await this.storage.upload(path, prepared.image.bytes, prepared.image.mime);

      return {
        type: "image",
        url: this.storage.publicUrl(path),
        path,
        width: prepared.image.width,
        height: prepared.image.height,
      };
    }

    const prepared = prepareCardFile({
      bytes: file.buffer,
      mime: file.mimetype,
      name: file.originalname,
    });

    if (!prepared.ok) {
      throw new BadRequestException({
        code: "BOT_FILE_INVALID",
        message: [prepared.reason],
      });
    }

    const path = cardFilePath({
      workspaceId,
      agentId,
      name: prepared.file.name,
    });

    await this.storage.upload(path, prepared.file.bytes, prepared.file.mime);

    return {
      type: "file",
      url: this.storage.publicUrl(path),
      path,
      name: prepared.file.name,
      kind: prepared.file.kind,
    };
  }

  /**
   * What was already uploaded for this agent, newest first, split by kind.
   *
   * The gallery is the bucket itself rather than a table on the flow: a file
   * nobody ends up choosing is harmless, and a list on the row would drift
   * from the objects it claims exist. A stored file knows its own name and
   * kind from its key, so nothing else has to be kept.
   */
  async mediaLibrary(
    claims: AuthClaims,
    agentId: string,
  ): Promise<CardMediaLibrary> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    await this.assertAgent(workspaceId, agentId);

    const folder = cardFolderFor(workspaceId, agentId);
    const objects = await this.storage.list(folder, { limit: 60 });

    const images: CardMediaLibrary["images"] = [];
    const files: CardMediaLibrary["files"] = [];

    for (const object of objects) {
      const path = `${folder}/${object.name}`;
      const stored = storedFile(path);

      if (stored) {
        files.push({
          url: this.storage.publicUrl(path),
          path,
          name: stored.name,
          kind: stored.kind,
          updatedAt: object.updatedAt,
        });
        continue;
      }

      if (!/\.jpe?g$/i.test(object.name)) continue;

      images.push({
        url: this.storage.publicUrl(path),
        path,
        updatedAt: object.updatedAt,
      });
    }

    // The storage listing sorts by name; the names start with a timestamp,
    // so reversing puts the newest upload first.
    return { images: images.reverse(), files: files.reverse() };
  }

  /**
   * Removes one uploaded picture or file from the bucket, for good.
   *
   * Two refusals before anything is deleted. A path outside this agent's folder
   * is unknown rather than forbidden — another workspace must not be able to
   * tell the two apart. An upload a saved card still sends is in use: deleting
   * it would leave that card pointing at a dead address, and Meta fetches the
   * address every time the card is shown.
   *
   * The second check reads every flow in the workspace, not this agent's. A
   * card can be shifted to another agent and keeps the address it was uploaded
   * to, so a guard that only looked here would happily delete an upload another
   * agent's bot is still sending.
   *
   * `strict` because this delete is not a side effect of something else the
   * user asked for: if storage refuses, the file is still there and the screen
   * must say so instead of hiding an orphan.
   */
  async removeMedia(
    claims: AuthClaims,
    agentId: string,
    path: string,
  ): Promise<{ removed: true }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    await this.assertAgent(workspaceId, agentId);

    const owned = ownedCardPath({ workspaceId, agentId, path });

    if (!owned) {
      throw new BadRequestException({
        code: "BOT_MEDIA_UNKNOWN",
        message: "That file is not one of this agent's uploads.",
      });
    }

    const url = this.storage.publicUrl(owned);

    // A database without the flow table has no saved cards, so nothing can be
    // pointing at the upload yet — that is not a reason to refuse the delete.
    const flows = await this.store
      .readWorkspace(workspaceId)
      .catch((error: unknown) => {
        if (BotStore.missingTable(error)) return [];

        throw error;
      });

    const holders = flows.flatMap(({ agentId: owner, flow }) =>
      flow.cards
        .filter(
          (card) =>
            card.imageUrls.includes(url) ||
            card.files.some((file) => file.url === url),
        )
        .map((card) => ({ card, elsewhere: owner !== agentId })),
    );

    if (holders.length > 0) {
      const [first] = holders;
      const name =
        first.card.name.trim() || first.card.title.trim() || "An untitled card";
      const more =
        holders.length > 1 ? ` and ${holders.length - 1} other card(s)` : "";
      // Named because the owner is looking at this agent's gallery and the
      // card may be one they cannot see from here.
      const away = holders.some((holder) => holder.elsewhere)
        ? " — one of them is on another agent's bot"
        : "";

      throw new ConflictException({
        code: "BOT_MEDIA_IN_USE",
        message: `${name}${more} still sends this upload${away}. Take it off the card (or save the change) and then remove it.`,
      });
    }

    await this.storage.remove([owned], { strict: true });

    return { removed: true };
  }

  private async assertAgent(workspaceId: string, agentId: string): Promise<void> {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, workspaceId },
      select: { id: true },
    });

    if (!agent) throw new NotFoundException("That agent does not exist.");
  }

  /**
   * The table ships as migration `0025_bot_flows`. A database that has not run
   * it gets "not installed yet" and the command that installs it -- not a 500
   * that reads like a bug in the editor.
   */
  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (BotStore.missingTable(error)) {
        throw new ServiceUnavailableException({
          code: "BOT_STORE_MISSING",
          message:
            "The chatbot table is not installed on this database yet. Run prisma migrate deploy (0025_bot_flows).",
        });
      }

      throw error;
    }
  }
}
