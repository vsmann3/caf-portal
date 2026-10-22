ALTER TABLE "CustomerApplication" ADD COLUMN "serviceRequestId" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "CustomerApplication_serviceRequestId_key" ON "CustomerApplication"("serviceRequestId");
-- Lifetime customer number is shared by explicit additional connections/drafts.
DROP INDEX "CustomerApplication_customerId_key";
DROP INDEX "CafDraft_customerId_key";
CREATE INDEX "CustomerApplication_customerId_idx" ON "CustomerApplication"("customerId");
CREATE INDEX "CafDraft_customerId_idx" ON "CafDraft"("customerId");
ALTER TABLE "CustomerNumber" ADD COLUMN "companyId" TEXT, ADD COLUMN "franchiseId" TEXT,
 ADD COLUMN "profileVersion" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "approvedProfile" JSONB,
 ADD COLUMN "profileApprovedAt" TIMESTAMP(3);
UPDATE "CustomerNumber" n SET "companyId"=a."companyId", "franchiseId"=a."franchiseId",
 "profileVersion"=CASE WHEN a.status='APPROVED' THEN 1 ELSE 0 END,
 "approvedProfile"=CASE WHEN a.status='APPROVED' THEN jsonb_build_object('name',a."customerName",'mobile',a.mobile,'email',a.email) ELSE NULL END,
 "profileApprovedAt"=CASE WHEN a.status='APPROVED' THEN COALESCE(a."reviewedAt",a."updatedAt") ELSE NULL END
 FROM "CustomerApplication" a WHERE a."customerId"=n.id;
UPDATE "CustomerNumber" n SET "companyId"=d."companyId", "franchiseId"=d."franchiseId"
 FROM "CafDraft" d WHERE d."customerId"=n.id AND n."companyId" IS NULL;
CREATE TABLE "RadiusDemoBinding" (
 "companyId" TEXT PRIMARY KEY, "sourceId" TEXT NOT NULL, "baseUrl" TEXT NOT NULL,
 "radiusCompanyId" TEXT NOT NULL, "tokenEncrypted" TEXT NOT NULL,
 "inboundTokenDigest" TEXT NOT NULL UNIQUE, "inboundExpiresAt" TIMESTAMP(3) NOT NULL,
 "franchiseMappings" JSONB NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "RadiusDemoIntent" (
 id UUID PRIMARY KEY, "draftId" TEXT NOT NULL UNIQUE, "ownerId" TEXT NOT NULL,
 "companyId" TEXT NOT NULL, "franchiseId" TEXT NOT NULL, "customerId" TEXT NOT NULL,
 username TEXT NOT NULL, "planId" UUID NOT NULL, "planVersion" INTEGER NOT NULL,
 plan JSONB NOT NULL, reservation JSONB, "renewalKey" UUID, "reservationId" UUID, "reservationExpiresAt" TIMESTAMP(3),
 "applicationId" TEXT UNIQUE, state TEXT NOT NULL DEFAULT 'RESERVING', "approvalVersion" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "RadiusDemoIntent_companyId_customerId_idx" ON "RadiusDemoIntent"("companyId","customerId");
CREATE TABLE "RadiusDemoDelivery" (
 id UUID PRIMARY KEY, "eventId" UUID NOT NULL UNIQUE, "intentId" UUID NOT NULL REFERENCES "RadiusDemoIntent"(id) ON DELETE RESTRICT,
 "applicationId" TEXT NOT NULL, revision INTEGER NOT NULL, "approvalVersion" INTEGER NOT NULL,
 "approvalEvent" JSONB NOT NULL, service JSONB NOT NULL, "secretEncrypted" TEXT,
 "secretExpiresAt" TIMESTAMP(3) NOT NULL, "requestHmac" TEXT NOT NULL,
 receipt JSONB, "receiptVersion" INTEGER NOT NULL DEFAULT 0, "credentialAccepted" BOOLEAN NOT NULL DEFAULT false,
 "serviceId" UUID, state TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "leaseUntil" TIMESTAMP(3), "leaseId" UUID,
 "errorCode" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE("applicationId",revision)
);
CREATE INDEX "RadiusDemoDelivery_state_nextAttemptAt_idx" ON "RadiusDemoDelivery"(state,"nextAttemptAt");
