-- AlterEnum
ALTER TYPE "MessageKind" ADD VALUE 'TEMPLATE';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "tap_target" JSONB,
ADD COLUMN     "template_language" TEXT,
ADD COLUMN     "template_name" TEXT;
