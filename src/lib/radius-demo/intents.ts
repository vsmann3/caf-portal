import "server-only";
import { randomUUID } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/guard";
import { availableUsername, filingFranchise } from "@/lib/caf-access";
import type { SessionPayload } from "@/lib/session";
import {
  bindingFor,
  radiusFranchise,
  radiusRequest,
  planPageSchema,
  reservationSchema,
  remoteError,
  json,
  uuid,
} from "./common";

export const reserveInput = z
  .object({
    draftId: z.string().min(1),
    draftVersion: z.number().int().positive(),
    planId: uuid,
    planVersion: z.number().int().positive().max(2147483647),
    username: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_.@-]+$/),
    existingCustomerId: z
      .string()
      .regex(/^[1-9][0-9]{9}$/)
      .optional(),
  })
  .strict();
export async function catalog(
  auth: SessionPayload,
  franchiseId: string,
  cursor?: string,
) {
  const franchise = await filingFranchise(auth, franchiseId);
  if (!franchise) throw new ApiError(404, "Franchise not found");
  const b = await bindingFor(franchise.companyId);
  radiusFranchise(b, franchise.id);
  const result = await radiusRequest(
    b,
    `/api/integrations/ecaf/v1/companies/${encodeURIComponent(b.radiusCompanyId)}/plans?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  if (result.status !== 200) remoteError(result.status, result.data);
  const parsed = planPageSchema.safeParse(result.data);
  if (
    !parsed.success ||
    parsed.data.items.some((p) => p.radius_company_id !== b.radiusCompanyId)
  )
    throw new ApiError(502, "RADIUS plan scope or schema mismatch");
  return parsed.data;
}
export function safeIntent(i: {
  id: string;
  customerId: string;
  username: string;
  planId: string;
  planVersion: number;
  state: string;
  reservationExpiresAt: Date | null;
}) {
  return {
    id: i.id,
    customerId: i.customerId,
    username: i.username,
    planId: i.planId,
    planVersion: i.planVersion,
    state: i.state,
    reservationExpiresAt: i.reservationExpiresAt,
  };
}
export async function reserve(
  auth: SessionPayload,
  input: z.infer<typeof reserveInput>,
) {
  let draft = await prisma.cafDraft.findFirst({
    where: { id: input.draftId, ownerId: auth.userId },
  });
  if (!draft) throw new ApiError(404, "Owned draft not found");
  const franchise = await filingFranchise(auth, draft.franchiseId);
  if (!franchise || franchise.companyId !== draft.companyId)
    throw new ApiError(404, "Draft scope not found");
  const b = await bindingFor(draft.companyId);
  const radiusFranchiseId = radiusFranchise(b, franchise.id);
  let intent = await prisma.radiusDemoIntent.findUnique({
    where: { draftId: draft.id },
  });
  if (
    intent &&
    (intent.ownerId !== auth.userId ||
      intent.username !== input.username ||
      intent.planId !== input.planId ||
      intent.planVersion !== input.planVersion ||
      (input.existingCustomerId &&
        intent.customerId !== input.existingCustomerId))
  )
    throw new ApiError(
      409,
      "Reservation binding changed. Start a new draft for a different service selection.",
    );
  if (!intent) {
    if (draft.version !== input.draftVersion)
      throw new ApiError(
        409,
        "Draft changed. Save and reload before reserving.",
      );
    let customerId = draft.customerId;
    if (input.existingCustomerId) {
      const master = await prisma.customerNumber.findFirst({
        where: {
          id: input.existingCustomerId,
          companyId: draft.companyId,
          profileVersion: { gt: 0 },
          franchiseId: franchise.id,

        },
      });
      if (!master)
        throw new ApiError(404, "Approved customer not found in this company and franchise");
      customerId = master.id;
    }
    if (!(await availableUsername(draft.companyId, [input.username])))
      throw new ApiError(409, "Username already exists in this company");
    let plan;
    let cursor: string | undefined;
    // Bounded complete catalog scan; never fabricate a plan from browser fields.
    for (let n = 0; n < 10; n++) {
      const page = await catalog(auth, franchise.id, cursor);
      plan = page.items.find(
        (p) => p.plan_id === input.planId && p.version === input.planVersion,
      );
      if (plan || !page.has_more) break;
      cursor = page.next_cursor!;
    }
    if (!plan)
      throw new ApiError(
        409,
        "Selected plan/version is no longer published. Reload plans.",
      );
    intent = await prisma.$transaction(async (tx) => {
      const changed = await tx.cafDraft.updateMany({
        where: {
          id: draft!.id,
          ownerId: auth.userId,
          version: input.draftVersion,
        },
        data: { customerId, version: { increment: 1 } },
      });
      if (!changed.count)
        throw new ApiError(409, "Draft changed during reservation");
      return tx.radiusDemoIntent.create({
        data: {
          id: randomUUID(),
          draftId: draft!.id,
          ownerId: auth.userId,
          companyId: draft!.companyId,
          franchiseId: franchise.id,
          customerId,
          username: input.username,
          planId: input.planId,
          planVersion: input.planVersion,
          plan: json(plan),
        },
      });
    });
  }
  if (intent.applicationId)
    throw new ApiError(
      409,
      "Reservation is already attached to a submitted CAF",
    );
  if (intent.state !== "RESERVED") {
    const result = await radiusRequest(
      b,
      "/api/integrations/ecaf/v1/username-reservations",
      "POST",
      {
        customer_id: intent.customerId,
        company_ref: { id: intent.companyId },
        franchise_ref: { id: intent.franchiseId },
        service_request_id: intent.id,
        username: intent.username,
        plan_id: intent.planId,
        plan_version: intent.planVersion,
      },
      intent.id,
    );
    if (![200, 201].includes(result.status))
      remoteError(result.status, result.data);
    const parsed = reservationSchema.safeParse(result.data);
    if (!parsed.success)
      throw new ApiError(502, "RADIUS reservation schema mismatch");
    const r = parsed.data;
    if (
      r.source_id !== b.sourceId ||
      r.customer_id !== intent.customerId ||
      r.company_ref.id !== intent.companyId ||
      r.franchise_ref.id !== intent.franchiseId ||
      r.radius_company_id !== b.radiusCompanyId ||
      r.radius_franchise_id !== radiusFranchiseId ||
      r.service_request_id !== intent.id ||
      r.username !== intent.username ||
      r.plan_id !== intent.planId ||
      r.plan_version !== intent.planVersion ||
      new Date(r.expires_at).getTime() <= Date.now()
    )
      throw new ApiError(502, "RADIUS reservation binding mismatch");
    intent = await prisma.radiusDemoIntent.update({
      where: { id: intent.id },
      data: {
        reservation: json(r),
        reservationId: r.reservation_id,
        reservationExpiresAt: new Date(r.expires_at),
        state: "RESERVED",
      },
    });
  }
  const metadata = JSON.stringify({ radiusDemoIntentId: intent.id, broadbandUsername: intent.username });
  await prisma.$executeRaw`UPDATE "CafDraft" SET payload = payload || ${metadata}::jsonb, version = version + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = ${draft.id} AND "ownerId" = ${auth.userId}`;
  draft = await prisma.cafDraft.findUniqueOrThrow({ where: { id: draft.id } });

  return { intent: safeIntent(intent), draft };
}
export async function renew(auth: SessionPayload, id: string) {
  let intent = await prisma.radiusDemoIntent.findUnique({ where: { id } });
  if (!intent) throw new ApiError(404, "Service reservation not found");
  const franchise = await filingFranchise(auth, intent.franchiseId);
  if (
    !franchise ||
    franchise.companyId !== intent.companyId ||
    (auth.role === "FRANCHISE_USER" && intent.ownerId !== auth.userId)
  )
    throw new ApiError(404, "Service reservation not found");
  const b = await bindingFor(intent.companyId);
  if (!intent.reservationId)
    throw new ApiError(
      409,
      "Initial reservation outcome must be reconciled first",
    );
  // No replacement of a delivery with unknown/accepted credentials. This action is pre-delivery only.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${intent!.id}))`;
    const job = await tx.radiusDemoDelivery.findFirst({
      where: { intentId: intent!.id },
    });
    if (job && (job.attempts > 0 || job.credentialAccepted || job.leaseUntil))
      throw new ApiError(
        409,
        "Delivery has already started; explicit receipt recovery is required",
      );
    if (job)
      await tx.radiusDemoDelivery.update({
        where: { id: job.id },
        data: { state: "RESERVATION_RENEWING" },
      });
    const fresh = await tx.radiusDemoIntent.findUniqueOrThrow({
      where: { id },
    });
    if (!fresh.renewalKey)
      await tx.radiusDemoIntent.update({
        where: { id },
        data: { renewalKey: randomUUID() },
      });
  });
  intent = await prisma.radiusDemoIntent.findUniqueOrThrow({ where: { id } });
  const result = await radiusRequest(
    b,
    `/api/integrations/ecaf/v1/username-reservations/${intent.reservationId}/renew`,
    "POST",
    {},
    intent.renewalKey!,
  );
  if (result.status !== 200) remoteError(result.status, result.data);
  const parsed = reservationSchema.safeParse(result.data);
  if (!parsed.success)
    throw new ApiError(502, "RADIUS renewal schema mismatch");
  const r = parsed.data;
  if (
    r.source_id !== b.sourceId ||
    r.customer_id !== intent.customerId ||
    r.company_ref.id !== intent.companyId ||
    r.franchise_ref.id !== intent.franchiseId ||
    r.radius_company_id !== b.radiusCompanyId ||
    r.radius_franchise_id !== radiusFranchise(b, intent.franchiseId) ||
    r.service_request_id !== intent.id ||
    r.reservation_id !== intent.reservationId ||
    r.username !== intent.username ||
    r.plan_id !== intent.planId ||
    r.plan_version !== intent.planVersion ||
    new Date(r.expires_at).getTime() <= Date.now()
  )
    throw new ApiError(502, "RADIUS renewal binding mismatch");
  intent = await prisma.$transaction(async (tx) => {
    const updated = await tx.radiusDemoIntent.update({
      where: { id },
      data: {
        reservation: json(r),
        reservationExpiresAt: new Date(r.expires_at),
        renewalKey: null,
      },
    });
    await tx.radiusDemoDelivery.updateMany({
      where: { intentId: id, state: "RESERVATION_RENEWING", attempts: 0 },
      data: { state: "PENDING", errorCode: null, nextAttemptAt: new Date() },
    });
    return updated;
  });
  return { intent: safeIntent(intent) };
}
