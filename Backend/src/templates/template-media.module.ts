import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { MEDIA_BUCKET, MediaStorage } from "../inbox/media.storage";
import { TemplatePhoto } from "./template-photo";

/**
 * The template bucket, owned once and shared.
 *
 * Both the templates module (upload, preview) and the two senders (inbox and
 * campaigns) need the same storage: a send mints its header image from the
 * object the templates module wrote, so a second instance with a second bucket
 * would look like "the image vanished". Exporting the class and `TemplatePhoto`
 * together keeps that one object path in one place.
 *
 * `InboxModule` still declares its own `MediaStorage` for customer attachments;
 * a module's own provider wins over an imported one, so the two buckets never
 * cross.
 */
@Module({
  providers: [
    MediaStorage,
    {
      provide: MEDIA_BUCKET,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>("TEMPLATE_MEDIA_BUCKET") ?? "template-media",
    },
    TemplatePhoto,
  ],
  exports: [MediaStorage, TemplatePhoto],
})
export class TemplateMediaModule {}
