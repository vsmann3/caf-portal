import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole, jsonError } from "@/lib/guard";
import { reviewApplicationSchema } from "@/lib/validators";
import { audit } from "@/lib/audit";
import { getRadiusConfig, getRadiusAdapter, buildRadiusPayload } from "@/lib/radius";

type Params = { params: Promise<{ id: string }> };

/**
 * Review workflow: SUBMITTED -> UNDER_REVIEW -> APPROVED / REJECTED.
 * Only super admins and company admins may review. Franchise users may NOT
 * approve their own submissions.
 * When APPROVED and RADIUS sync is enabled, push to RADIUS (adapter-based, retry-queued).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireRole(["SUPER_ADMIN", "COMPANY_ADMIN"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = reviewApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { action, rejectionReason } = parsed.data;

  const existing = await prisma.customerApplication.findFirst({
    where: {
      id,
      // Company admins may only review applications of their own company.
      ...(auth.role === "COMPANY_ADMIN" && auth.companyId ? { companyId: auth.companyId } : {}),
    },
    include: { company: true, franchise: true },
  });
  if (!existing) return jsonError(404, "Application not found");
  if (existing.status === "APPROVED" || existing.status === "REJECTED") {
    return jsonError(400, `Application is already ${existing.status.toLowerCase()}`);
  }
  if (action === "REJECT" && !rejectionReason) {
    return jsonError(400, "A rejection reason is required");
  }

  const status =
    action === "APPROVE" ? "APPROVED" : action === "REJECT" ? "REJECTED" : "UNDER_REVIEW";

  const application = await prisma.customerApplication.update({
    where: { id },
    data: {
      status,
      reviewedById: auth.userId,
      reviewedAt: new Date(),
      rejectionReason: action === "REJECT" ? rejectionReason : null,
    },
  });

  await audit(auth, `caf.${status.toLowerCase()}`, "CustomerApplication", id, {
    cafNumber: existing.cafNumber,
  });

  // RADIUS sync on approval (event-based)
  if (action === "APPROVE") {
    try {
      const config = await getRadiusConfig();
      const sync = await prisma.radiusSync.create({
        data: {
          applicationId: id,
          status: "PENDING",
          requestPayload: buildRadiusPayload(existing, existing.franchise),
        },
      });
      if (config.enabled) {
        const adapter = getRadiusAdapter(config);
        try {
          const res = await adapter.createOrActivate(sync.requestPayload as any);
          await prisma.radiusSync.update({
            where: { id: sync.id },
            data: {
              status: res.ok ? "SUCCESS" : "FAILED",
              responsePayload: res.raw as object,
              errorMessage: res.error ?? null,
              attempts: 1,
              lastAttemptAt: new Date(),
              completedAt: res.ok ? new Date() : null,
            },
          });
          if (res.ok) {
            await audit(auth, "radius.sync.success", "CustomerApplication", id, {
              cafNumber: existing.cafNumber,
            });
          } else {
            await audit(auth, "radius.sync.failed", "CustomerApplication", id, {
              cafNumber: existing.cafNumber,
              error: res.error,
            });
          }
        } catch (e) {
          await prisma.radiusSync.update({
            where: { id: sync.id },
            data: {
              status: "FAILED",
              errorMessage: (e as Error).message,
              attempts: 1,
              lastAttemptAt: new Date(),
            },
          });
          await audit(auth, "radius.sync.failed", "CustomerApplication", id, {
            cafNumber: existing.cafNumber,
            error: (e as Error).message,
          });
        }
      }
      // If disabled, sync record remains PENDING for manual/cron processing later.
    } catch (e) {
      console.error("RADIUS sync enqueue failed", e);
    }
  }

  return NextResponse.json({ application });
}
