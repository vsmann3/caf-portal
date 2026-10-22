import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole, jsonError } from "@/lib/guard";
import { reviewApplicationSchema } from "@/lib/validators";
import { audit } from "@/lib/audit";
import {
  radiusBlockedResult,
  buildRadiusApprovalReference,
} from "@/lib/radius";
import { recordDemoApproval } from "@/lib/radius-demo/approval";
import { applicationScope } from "@/lib/caf-access";

type Params = { params: Promise<{ id: string }> };

/**
 * Review workflow: SUBMITTED -> UNDER_REVIEW -> APPROVED / REJECTED.
 * Only super admins and company admins may review. Franchise users may NOT
 * approve their own submissions.
 * Approval records a blocked local RADIUS diagnostic atomically; no transport exists.
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
      ...applicationScope(auth),
    },
    include: {
      company: true,
      franchise: true,
      documents: { orderBy: { uploadedAt: "asc" } },
    },
  });
  if (!existing) return jsonError(404, "Application not found");
  if (!existing.company.isActive || !existing.franchise.isActive) return jsonError(409, "Company and franchise must be active before review");
  if (existing.status !== "SUBMITTED" && existing.status !== "UNDER_REVIEW") {
    return jsonError(409, "Only submitted applications can be reviewed");
  }
  if (action === "REJECT" && !rejectionReason) {
    return jsonError(400, "A rejection reason is required");
  }

  const status =
    action === "APPROVE"
      ? "APPROVED"
      : action === "REJECT"
        ? "REJECTED"
        : "UNDER_REVIEW";

  const application = await prisma
    .$transaction(async (tx) => {
      const changed = await tx.customerApplication.updateMany({
        where: { id, status: existing.status, revision: existing.revision },
        data: {
          status,
          reviewedById: auth.userId,
          reviewedAt: new Date(),
          rejectionReason: action === "REJECT" ? rejectionReason : null,
          ...(action === "APPROVE"
            ? {
                approvedSnapshot: JSON.parse(
                  JSON.stringify({
                    ...existing,
                    status: "APPROVED",
                    reviewedById: auth.userId,
                    approvedBy: { id: auth.userId, name: auth.name },
                    approvedAt: new Date().toISOString(),
                  }),
                ),
              }
            : {}),
        },
      });
      if (!changed.count) return null;
      const approved = await tx.customerApplication.findUniqueOrThrow({
        where: { id },
      });
      if (action === "APPROVE") {
        await recordDemoApproval(tx, approved);
        const setting = await tx.systemSetting.findUnique({
          where: { key: "radius.config" },
        });
        const config = setting?.value;
        const enabled =
          config &&
          typeof config === "object" &&
          !Array.isArray(config) &&
          config.enabled === true;
        const blocked = radiusBlockedResult(Boolean(enabled));
        await tx.radiusSync.create({
          data: {
            applicationId: id,
            // Existing enum: FAILED + explicit reason means blocked, not attempted.
            status: "FAILED",
            requestPayload: JSON.parse(
              JSON.stringify(buildRadiusApprovalReference(approved)),
            ),
            responsePayload: { code: blocked.code, attempted: false },
            errorMessage: blocked.error,
            attempts: 0,
          },
        });
      }
      return approved;
    })
    .catch(() =>
      jsonError(500, "Unable to confirm review. Reload before retrying."),
    );
  if (application instanceof NextResponse) return application;
  if (!application)
    return jsonError(
      409,
      "Application changed during review. Reload and review again.",
    );

  await audit(auth, `caf.${status.toLowerCase()}`, "CustomerApplication", id, {
    cafNumber: existing.cafNumber,
  });

  return NextResponse.json({ application });
}
