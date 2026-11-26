import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";

import type { AuthClaims } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import type { UploadedMedia } from "../inbox/inbox.sender";
import { Roles } from "../workspaces/workspace-roles.decorator";
import { WorkspaceRolesGuard } from "../workspaces/workspace-roles.guard";
import { AddTextSourceDto } from "./dto/add-text-source.dto";
import {
  AUDIO_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  extensionOf,
} from "./knowledge.file";
import { KnowledgeService, MAX_SOURCE_BYTES } from "./knowledge.service";
import { SourceTooLargeFilter } from "./source-too-large.filter";

const ALLOWED = new Set<string>([
  ...DOCUMENT_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
]);

/**
 * A cheap pre-filter that answers before Multer buffers a 25 MB body. The
 * service still validates the bytes; this only saves the round trip.
 */
const acceptUpload = (
  _request: unknown,
  file: { originalname: string },
  done: (error: Error | null, acceptFile: boolean) => void,
) => {
  if (ALLOWED.has(extensionOf(file.originalname))) return done(null, true);

  // A non-MulterError passes through Nest's interceptor untouched when it is an
  // HttpException, so the client sees 415 rather than 500.
  done(
    new UnsupportedMediaTypeException(
      "That file type cannot be read. Upload a PDF, DOCX, TXT, CSV, XLSX, an image, or a voice note.",
    ),
    false,
  );
};

/**
 * Training material for one agent. A source is indexed in the background, so
 * every route here answers immediately with `PENDING` and the screen polls the
 * list while the runner works.
 */
@Controller("v1/agents/:id/sources")
@UseGuards(SupabaseAuthGuard, WorkspaceRolesGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  /** GET /api/v1/agents/:id/sources — newest first, every status. */
  @Get()
  list(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.knowledge.list(claims, id);
  }

  /** POST /api/v1/agents/:id/sources/text — a typed note or pasted policy. */
  @Post("text")
  @Roles("OWNER")
  addText(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AddTextSourceDto,
  ) {
    return this.knowledge.addText(claims, id, dto);
  }

  /**
   * POST /api/v1/agents/:id/sources/file — multipart, field `file`.
   *
   * The extension picks the reader, the bytes decide whether the file really is
   * that format, and the sniffed type — not the browser's mimetype — is what
   * gets stored. A phone that sends `application/octet-stream` still indexes.
   */
  @Post("file")
  @Roles("OWNER")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  // Multer's own size refusal is a bare 413; this gives it the same body the
  // service's `SOURCE_TOO_LARGE` carries.
  @UseFilters(SourceTooLargeFilter)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_SOURCE_BYTES },
      fileFilter: acceptUpload,
    }),
  )
  addFile(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedMedia | undefined,
  ) {
    if (!file) {
      // Without this the service would store an empty buffer and index nothing.
      throw new BadRequestException("Attach a file to train on.");
    }

    return this.knowledge.addFile(claims, id, file);
  }

  /**
   * PUT /api/v1/agents/:id/sources/:sourceId/file — the new version of a file.
   *
   * The old source keeps answering until the replacement is READY, so the row
   * this returns is the *new* source; the screen follows it like any upload and
   * the old one disappears when indexing retires it.
   */
  @Put(":sourceId/file")
  @Roles("OWNER")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseFilters(SourceTooLargeFilter)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_SOURCE_BYTES },
      fileFilter: acceptUpload,
    }),
  )
  replace(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("sourceId", ParseUUIDPipe) sourceId: string,
    @UploadedFile() file: UploadedMedia | undefined,
  ) {
    if (!file) {
      throw new BadRequestException("Attach the new version of the file.");
    }

    return this.knowledge.replace(claims, id, sourceId, file);
  }

  /** GET .../download — a short-lived link, issued only after an ownership check. */
  @Get(":sourceId/download")
  download(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("sourceId", ParseUUIDPipe) sourceId: string,
  ) {
    return this.knowledge.downloadLink(claims, id, sourceId);
  }

  /** DELETE /api/v1/agents/:id/sources/:sourceId — the row, chunks and bytes. */
  @Delete(":sourceId")
  @Roles("OWNER")
  remove(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("sourceId", ParseUUIDPipe) sourceId: string,
  ) {
    return this.knowledge.remove(claims, id, sourceId);
  }

  /** POST /api/v1/agents/:id/sources/:sourceId/retry — back to PENDING. */
  @Post(":sourceId/retry")
  @Roles("OWNER")
  @HttpCode(200)
  retry(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("sourceId", ParseUUIDPipe) sourceId: string,
  ) {
    return this.knowledge.retry(claims, id, sourceId);
  }
}
