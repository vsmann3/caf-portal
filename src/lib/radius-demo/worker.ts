import "server-only";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import {
  bindingFor,
  radiusFranchise,
  requireDemo,
  radiusRequest,
  receiptSchema,
  requestHmac,
  canonicalJson,
  acceptsSyntheticDemoActive,
  json,
} from "./common";
import type {
  RadiusDemoDelivery,
  RadiusDemoIntent,
  RadiusDemoBinding,
} from "@prisma/client";

export function verifyDemoReceipt(
  value: unknown,
  job: RadiusDemoDelivery,
  intent: RadiusDemoIntent,
  b: RadiusDemoBinding,
) {
  const r = receiptSchema.parse(value);
  if (
    r.source_id !== b.sourceId ||
    r.customer_id !== intent.customerId ||
    r.company_ref.id !== intent.companyId ||
    r.franchise_ref.id !== intent.franchiseId ||
    r.radius_company_id !== b.radiusCompanyId ||
    r.radius_franchise_id !== radiusFranchise(b, intent.franchiseId) ||
    r.provisioning_request_id !== job.id ||
    r.event_id !== job.eventId ||
    r.service_request_id !== intent.id ||
    (r.credential_accepted && !r.service_id) ||
    (r.service_status === "active" && !r.credential_accepted) ||
    (job.serviceId && job.serviceId !== r.service_id)
  )
    throw new Error("receipt_binding_mismatch");
  // No active service is authorized by this stage-only demo. Surface and stop on violation.
  // An unexpected active receipt is recorded as a violation, never interpreted as our authorization.
  return r;
}
export async function runDemoWorker(deliveryId?: string) {
  requireDemo();
  await prisma.radiusDemoDelivery.updateMany({
    where: {
      secretEncrypted: { not: null },
      secretExpiresAt: { lte: new Date() },
      credentialAccepted: false,
    },
    data: {
      secretEncrypted: null,
      state: "RECOVERY_REQUIRED",
      errorCode: "credential_deadline_expired",
    },
  });
  const now = new Date(),
    leaseId = randomUUID();
  // Multiple workers claim with CAS; no DB transaction/row lock held over HTTP.
  const candidate = await prisma.radiusDemoDelivery.findFirst({
    where: {
      ...(deliveryId ? { id: deliveryId } : {}),
      state: { in: ["PENDING", "RECONCILING", "WAITING"] },
      nextAttemptAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return { processed: false };
  const claim = await prisma.radiusDemoDelivery.updateMany({
    where: {
      id: candidate.id,
      state: { in: ["PENDING", "RECONCILING", "WAITING"] },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    data: {
      leaseId,
      leaseUntil: new Date(now.getTime() + 40000),
      attempts: { increment: 1 },
    },
  });
  if (!claim.count) return { processed: false };
  const job = await prisma.radiusDemoDelivery.findUniqueOrThrow({
    where: { id: candidate.id },
    include: { intent: true },
  });
  async function update(
    data: Parameters<typeof prisma.radiusDemoDelivery.updateMany>[0]["data"],
  ) {
    return prisma.radiusDemoDelivery.updateMany({
      where: { id: job.id, leaseId },
      data: { ...data, leaseId: null, leaseUntil: null },
    });
  }
  try {
    const b = await bindingFor(job.intent.companyId);
    const franchise = await prisma.franchise.findFirst({ where: { id: job.intent.franchiseId, companyId: job.intent.companyId, isActive: true } });
    if (!franchise) { await update({ state: "RECOVERY_REQUIRED", secretEncrypted: null, errorCode: "franchise_inactive" }); return { processed: true }; }
    const app = await prisma.customerApplication.findUniqueOrThrow({
      where: { id: job.applicationId },
    });
    if (
      app.status !== "APPROVED" ||
      app.revision !== job.revision ||
      app.customerId !== job.intent.customerId ||
      app.companyId !== job.intent.companyId ||
      app.franchiseId !== job.intent.franchiseId ||
      app.broadbandUsername !== job.intent.username
    ) {
      await update({
        state: "RECOVERY_REQUIRED",
        secretEncrypted: null,
        errorCode: "approval_binding_changed",
      });
      return { processed: true };
    }
    const path = `/api/integrations/ecaf/v2/provisionings/${job.id}`;
    // Always resolve an earlier/lost POST response before attempting another POST.
    let result = await radiusRequest(b, path);
    if (result.status === 404) {
      if (job.credentialAccepted) throw new Error("accepted_receipt_missing");
      if (job.secretExpiresAt.getTime() <= Date.now() || !job.secretEncrypted) {
        await update({
          state: "RECOVERY_REQUIRED",
          secretEncrypted: null,
          errorCode: "credential_deadline_expired",
        });
        return { processed: true };
      }
      if (
        !job.intent.reservationExpiresAt ||
        job.intent.reservationExpiresAt.getTime() <= Date.now()
      ) {
        await update({
          state: "RECOVERY_REQUIRED",
          errorCode: "reservation_expired",
        });
        return { processed: true };
      }
      const service = job.service as Record<string, unknown>;
      const body = {
        schema_version: "2.0",
        provisioning_request_id: job.id,
        supersedes_request_id: null,
        approval: job.approvalEvent,
        service: {
          ...service,
          initial_password: decryptSecret(job.secretEncrypted),
        },
      };
      if (requestHmac(body) !== job.requestHmac)
        throw new Error("immutable_request_changed");
      result = await radiusRequest(
        b,
        "/api/integrations/ecaf/v2/provisionings",
        "POST",
        body,
        job.id,
      );
    }
    if (![200, 201, 202, 409].includes(result.status)) {
      await update({
        state: "RECONCILING",
        nextAttemptAt: new Date(Date.now() + 30000),
        errorCode: "radius_unavailable",
      });
      return { processed: true };
    }
    // 409 may include a durable failed receipt; an error envelope must never imply acceptance.
    const r = verifyDemoReceipt(result.data, job, job.intent, b);
    if (r.receipt_version < job.receiptVersion) {
      await update({
        state: "WAITING",
        nextAttemptAt: new Date(Date.now() + 30000),
        errorCode: "older_receipt_ignored",
      });
      return { processed: true };
    }
    if (
      (job.credentialAccepted && !r.credential_accepted) ||
      (r.receipt_version === job.receiptVersion &&
        job.receipt &&
        canonicalJson(r) !== canonicalJson(job.receipt))
    )
      throw new Error("receipt_transition_conflict");
    const state =
      r.service_status === "active"
        ? acceptsSyntheticDemoActive(b) ? "DEMO_ACTIVE" : "UNEXPECTED_ACTIVE"
        : r.credential_accepted
          ? r.service_status === "pending_service_setup"
            ? "STAGED"
            : "ACCEPTED_BLOCKED"
          : r.error?.retryable
            ? "WAITING"
            : "RECOVERY_REQUIRED";
    await update({
      receipt: json(r),
      receiptVersion: r.receipt_version,
      credentialAccepted: job.credentialAccepted || r.credential_accepted,
      serviceId: r.service_id,
      state,
      errorCode:
        r.service_status === "active" && !acceptsSyntheticDemoActive(b)
          ? "unexpected_demo_activation"
          : (r.error?.code ?? null),
      ...(r.credential_accepted ? { secretEncrypted: null } : {}),
      nextAttemptAt: new Date(Date.now() + 30000),
    });
    return { processed: true, state };
  } catch (error) {
    // No raw response, token, password or exception detail is logged/persisted.
    const terminal =
      error instanceof Error &&
      [
        "receipt_binding_mismatch",
        "unexpected_demo_activation",
        "immutable_request_changed",
        "accepted_receipt_missing",
        "receipt_transition_conflict",
      ].includes(error.message);
    await update({
      state: terminal ? "RECOVERY_REQUIRED" : "RECONCILING",
      errorCode: terminal
        ? (error as Error).message
        : "receipt_reconciliation_required",
      nextAttemptAt: new Date(Date.now() + 30000),
    });
    return { processed: true, state: "RECONCILING" };
  } finally {
    // Absolute expiry is independent of retry timing or remote availability, including blocked jobs.
    await prisma.radiusDemoDelivery.updateMany({
      where: {
        secretEncrypted: { not: null },
        secretExpiresAt: { lte: new Date() },
      },
      data: { secretEncrypted: null },
    });
  }
}
