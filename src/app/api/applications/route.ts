import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole, jsonError, scopeOf } from "@/lib/guard";
import { saveApplication } from "@/lib/save-application";

/** List applications (CAF records) visible to the caller. */
export async function GET(request: NextRequest) {
  const auth = await requireRole(["SUPER_ADMIN", "COMPANY_ADMIN", "FRANCHISE_USER"]);
  if (auth instanceof NextResponse) return auth;

  const scope = scopeOf(auth);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const q = url.searchParams.get("q")?.trim();
  const franchiseIdParam = url.searchParams.get("franchiseId") ?? undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? "20") || 20));

  const where: Record<string, unknown> = {};
  if (scope.kind === "company") where.companyId = scope.companyId;
  if (scope.kind === "franchise") {
    where.companyId = scope.companyId;
    where.franchiseId = scope.franchiseId;
  }
  // Company admin / super admin may additionally filter by franchise.
  if (
    franchiseIdParam &&
    (scope.kind === "company" || scope.kind === "all")
  ) {
    where.franchiseId = franchiseIdParam;
  }
  if (status) where.status = status;
  if (q) {
    where.OR = [
      { customerName: { contains: q, mode: "insensitive" } },
      { mobile: { contains: q } },
      { cafNumber: { contains: q, mode: "insensitive" } },
      { idNumber: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.customerApplication.count({ where }),
    prisma.customerApplication.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        franchise: { select: { id: true, name: true, code: true } },
        company: { select: { id: true, name: true, companyCode: true } },
        submittedBy: { select: { id: true, name: true } },
        _count: { select: { documents: true } },
      },
    }),
  ]);

  return NextResponse.json({ items, total, page, pageSize });
}


export const POST = saveApplication;
