import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole, jsonError, scopeOf } from "@/lib/guard";

type Params = { params: Promise<{ id: string }> };

/** Fetch full application detail (incl. documents) — scope-checked. */
export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireRole(["SUPER_ADMIN", "COMPANY_ADMIN", "FRANCHISE_USER"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const scope = scopeOf(auth);
  const where: Record<string, unknown> = { id };
  if (scope.kind === "company") where.companyId = scope.companyId;
  if (scope.kind === "franchise") {
    where.companyId = scope.companyId;
    where.franchiseId = scope.franchiseId;
  }

  const application = await prisma.customerApplication.findFirst({
    where,
    include: {
      documents: { orderBy: { uploadedAt: "asc" } },
      franchise: { select: { id: true, name: true, code: true, city: true } },
      company: { select: { id: true, name: true, companyCode: true } },
      submittedBy: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true, email: true } },
    },
  });
  if (!application) return jsonError(404, "Application not found");
  return NextResponse.json({ application });
}
