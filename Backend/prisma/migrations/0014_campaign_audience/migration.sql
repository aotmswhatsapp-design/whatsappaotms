-- Campaign audiences: a list of numbers as well as the tag segment.
CREATE TYPE "AudienceSource" AS ENUM ('LIST', 'SEGMENT');

-- Existing campaigns keep the tag behaviour they were created with.
ALTER TABLE "campaigns"
  ADD COLUMN "audience_source" "AudienceSource" NOT NULL DEFAULT 'SEGMENT';

-- Imported with a campaign list; never part of a template parameter.
ALTER TABLE "contacts"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "external_id" TEXT;
