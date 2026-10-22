import "server-only";
import { randomBytes, randomUUID } from "crypto";
import type { Prisma, CustomerApplication } from "@prisma/client";
import { encryptSecret } from "@/lib/crypto";
import { ApiError } from "@/lib/guard";
import { demoEnabled, json, requestHmac } from "./common";

export async function recordDemoApproval(
  tx: Prisma.TransactionClient,
  app: CustomerApplication,
) {
  const master = await tx.customerNumber.findUniqueOrThrow({
    where: { id: app.customerId },
  });
  if (master.companyId && master.companyId !== app.companyId)
    throw new ApiError(409, "Customer belongs to another company");
  const profile = {
    name: app.customerName,
    mobile: app.mobile || null,
    email: app.email || null,
  };
  const now = new Date();
  const updated = await tx.customerNumber.update({
    where: { id: app.customerId },
    data: {
      companyId: app.companyId,
      franchiseId: app.franchiseId,
      profileVersion: { increment: 1 },
      approvedProfile: profile,
      profileApprovedAt: now,
    },
  });
  const intent = await tx.radiusDemoIntent.findUnique({
    where: { applicationId: app.id },
  });
  if (!intent) return;
  if (
    !demoEnabled() ||
    intent.companyId !== app.companyId ||
    intent.franchiseId !== app.franchiseId ||
    intent.customerId !== app.customerId ||
    intent.username !== app.broadbandUsername
  )
    throw new ApiError(
      409,
      "Demo approval binding mismatch or isolated demo disabled",
    );
  if (!intent.reservationId)
    throw new ApiError(409, "Reservation is required before approval");
  const prior = await tx.radiusDemoDelivery.findUnique({
    where: {
      applicationId_revision: { applicationId: app.id, revision: app.revision },
    },
  });
  if (prior) throw new ApiError(409, "Approval delivery already exists");
  const eventId = randomUUID(),
    id = randomUUID();
  const approval = {
    schema_version: "1.0",
    event_id: eventId,
    event_type: "customer.approved",
    occurred_at: now.toISOString(),
    customer_version: updated.profileVersion,
    customer_id: app.customerId,
    company_ref: { id: app.companyId },
    franchise_ref: { id: app.franchiseId },
    caf: {
      application_id: app.id,
      number: app.cafNumber,
      revision: app.revision,
      status: "APPROVED",
      approved_at: now.toISOString(),
    },
    profile,
  };
  // Server-generated only; never put credentials in browser drafts, snapshots, logs or audit.
  const secret = randomBytes(24).toString("base64url");
  const service = {
    service_request_id: intent.id,
    reservation_id: intent.reservationId,
    username: intent.username,
    plan_id: intent.planId,
  };
  const body = {
    schema_version: "2.0",
    provisioning_request_id: id,
    supersedes_request_id: null,
    approval,
    service: { ...service, initial_password: secret },
  };
  const version = intent.approvalVersion + 1;
  await tx.radiusDemoIntent.update({
    where: { id: intent.id },
    data: { approvalVersion: version, state: "APPROVED" },
  });
  await tx.radiusDemoDelivery.create({
    data: {
      id,
      eventId,
      intentId: intent.id,
      applicationId: app.id,
      revision: app.revision,
      approvalVersion: version,
      approvalEvent: json(approval),
      service,
      secretEncrypted: encryptSecret(secret),
      secretExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      requestHmac: requestHmac(body),
    },
  });
}
