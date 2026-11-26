import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import type { AuthClaims } from "../auth/auth.types";
import { MediaStorage } from "../inbox/media.storage";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { BotFlow } from "./bot.card";
import { emptyFlow, flowProblem } from "./bot.flow";
import { cardFolderFor, cardImagePath, prepareCardImage } from "./bot.media";
import { flowIn } from "./bot.snapshot";
import { BotStore } from "./bot.store";

/** A flow plus whether anybody has written it down yet. */
export interface BotView {
  flow: BotFlow;
  stored: boolean;
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

/** One entry in the gallery a card's Picture field offers. */
export interface CardImageLibrary {
  images: (StoredCardImage & { updatedAt: string | null })[];
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

    return flow
      ? { flow, stored: true }
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
   * One card picture in, one permanent address out.
   *
   * The bucket is public on purpose: this URL is written into the flow and
   * fetched by Meta when the customer is shown the card, which is often long
   * after the upload — a signed link would be dead by then.
   */
  async uploadImage(
    claims: AuthClaims,
    agentId: string,
    file: UploadedBotImage | undefined,
  ): Promise<UploadedCardImage> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    await this.assertAgent(workspaceId, agentId);

    if (!file?.buffer.length) {
      throw new BadRequestException("Choose a picture to upload.");
    }

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
      url: this.storage.publicUrl(path),
      path,
      width: prepared.image.width,
      height: prepared.image.height,
    };
  }

  /**
   * What was already uploaded for this agent, newest first.
   *
   * The gallery is the bucket itself rather than a table on the flow: a
   * picture nobody ends up choosing is harmless, and a list on the row would
   * drift from the objects it claims exist.
   */
  async imageLibrary(
    claims: AuthClaims,
    agentId: string,
  ): Promise<CardImageLibrary> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    await this.assertAgent(workspaceId, agentId);

    const folder = cardFolderFor(workspaceId, agentId);
    const objects = await this.storage.list(folder, { limit: 60 });

    return {
      images: objects
        .filter((object) => /\.jpe?g$/i.test(object.name))
        .map((object) => {
          const path = `${folder}/${object.name}`;

          return {
            url: this.storage.publicUrl(path),
            path,
            updatedAt: object.updatedAt,
          };
        })
        // The storage listing sorts by name; the names start with a timestamp,
        // so reversing puts the newest upload first.
        .reverse(),
    };
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
