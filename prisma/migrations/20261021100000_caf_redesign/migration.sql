BEGIN;
ALTER TYPE "DocumentType" ADD VALUE 'GST_CERTIFICATE';
ALTER TABLE "CustomerApplication"
  ADD COLUMN "businessName" TEXT,
  ADD COLUMN "gstNumber" TEXT,
  ADD COLUMN "declarationAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "approvedSnapshot" JSONB;

-- Do not rename existing service accounts to resolve conflicts. A clear
-- preflight error leaves existing records untouched for operator review.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "CustomerApplication"
    WHERE NULLIF(BTRIM("broadbandUsername"), '') IS NOT NULL
    GROUP BY "companyId", LOWER(BTRIM("broadbandUsername")) HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate service usernames within a company. Review existing CAF usernames before retrying migration; no accounts have been renamed.';
  END IF;
END $$;
-- Expression index preserves historical spelling while enforcing case-insensitive uniqueness.
CREATE UNIQUE INDEX "CustomerApplication_company_username_normalized_key"
 ON "CustomerApplication" ("companyId", LOWER(BTRIM("broadbandUsername")))
 WHERE NULLIF(BTRIM("broadbandUsername"), '') IS NOT NULL;
CREATE UNIQUE INDEX "CustomerApplication_companyId_broadbandUsername_key"
 ON "CustomerApplication" ("companyId", "broadbandUsername")
 WHERE NULLIF(BTRIM("broadbandUsername"), '') IS NOT NULL;

CREATE TABLE "CafDraft" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
 "franchiseId" TEXT NOT NULL REFERENCES "Franchise"("id") ON DELETE CASCADE,
 "payload" JSONB NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "CafDraft_ownerId_idx" ON "CafDraft"("ownerId");
COMMIT;
