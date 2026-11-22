-- Sample media for template IMAGE headers.
--
-- All five columns are nullable on purpose: a text-header template has none,
-- and so does every template created in WhatsApp Manager before this release.
-- The original stays in the `template-media` bucket; `media_handle` is Meta's
-- resumable-upload handle, kept for diagnosis because it expires in 30 days.

-- AlterTable
ALTER TABLE "message_templates" ADD COLUMN     "media_handle" TEXT,
ADD COLUMN     "media_mime" TEXT,
ADD COLUMN     "media_path" TEXT,
ADD COLUMN     "media_size" INTEGER,
ADD COLUMN     "media_uploaded_at" TIMESTAMP(3);
