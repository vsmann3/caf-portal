BEGIN;
ALTER TABLE "Document" ADD COLUMN "sha256" TEXT;
CREATE SEQUENCE customer_id_sequence AS BIGINT MINVALUE 1000000000 MAXVALUE 9999999999 START 1000000000 NO CYCLE;
CREATE TABLE "CustomerNumber" (
 "id" TEXT NOT NULL DEFAULT nextval('customer_id_sequence')::text PRIMARY KEY,
 CONSTRAINT "CustomerNumber_ten_digits" CHECK ("id" ~ '^[1-9][0-9]{9}$')
);
ALTER TABLE "CustomerApplication" ADD COLUMN "customerId" TEXT;
ALTER TABLE "CafDraft" ADD COLUMN "customerId" TEXT;
CREATE TEMP TABLE customer_id_backfill ON COMMIT DROP AS
SELECT kind, id, nextval('customer_id_sequence')::text AS "customerId"
FROM (
 SELECT 'application' AS kind, id, "createdAt" FROM "CustomerApplication"
 UNION ALL
 SELECT 'draft' AS kind, id, "createdAt" FROM "CafDraft"
) records ORDER BY "createdAt", id;
INSERT INTO "CustomerNumber" (id) SELECT "customerId" FROM customer_id_backfill;
UPDATE "CustomerApplication" app SET "customerId" = assigned."customerId"
 FROM customer_id_backfill assigned WHERE assigned.kind = 'application' AND assigned.id = app.id;
UPDATE "CafDraft" draft SET "customerId" = assigned."customerId"
 FROM customer_id_backfill assigned WHERE assigned.kind = 'draft' AND assigned.id = draft.id;
-- Add only the newly allocated identifier; preserve all previously reviewed data.
UPDATE "CustomerApplication" SET "approvedSnapshot" = jsonb_set("approvedSnapshot", '{customerId}', to_jsonb("customerId"))
 WHERE jsonb_typeof("approvedSnapshot") = 'object';
ALTER TABLE "CustomerApplication" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "CafDraft" ALTER COLUMN "customerId" SET NOT NULL;
CREATE UNIQUE INDEX "CustomerApplication_customerId_key" ON "CustomerApplication"("customerId");
CREATE UNIQUE INDEX "CafDraft_customerId_key" ON "CafDraft"("customerId");
ALTER TABLE "CustomerApplication" ADD CONSTRAINT "CustomerApplication_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerNumber"(id) ON DELETE RESTRICT;
ALTER TABLE "CafDraft" ADD CONSTRAINT "CafDraft_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerNumber"(id) ON DELETE RESTRICT;
COMMIT;
