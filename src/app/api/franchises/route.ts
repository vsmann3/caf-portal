import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole, jsonError, scopeOf } from "@/lib/guard";
import { createFranchiseSchema } from "@/lib/validators";
import { franchiseCode } from "@/lib/codes";
import { audit } from "@/lib/audit";

/** List franchises visible to the caller (scoped by role). */
export async function GET() {
  const auth = await requireRole(["SUPER_ADMIN", "COMPANY_ADMIN", "FRANCHISE_USER"]);
  if (auth instanceof NextResponse) return auth;

  const scope = scopeOf(auth);
  let where = {};
  if (scope.kind === "company") where = { companyId: scope.companyId };
  else if (scope.kind === "franchise")
    where = { companyId: scope.companyId, id: scope.franchiseId };

  const franchises = await prisma.franchise.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      company: { select: { id: true, name: true, companyCode: true } },
      _count: { select: { users: true, applications: true } },
    },
  });
  return NextResponse.json({ franchises });
}

/** Create a franchise.
 *  - SUPER_ADMIN: must pass companyId of the target company.
 *  - COMPANY_ADMIN: created under own company.
 *  - FRANCHISE_USER: not allowed.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(["SUPER_ADMIN", "COMPANY_ADMIN"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = createFranchiseSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const data = parsed.data;

  const companyId = auth.role === "SUPER_ADMIN" ? data.companyId : auth.companyId;
  if (!companyId) return jsonError(400, "Company is required");

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return jsonError(404, "Company not found");
  if (!company.isActive) return jsonError(400, "Company is deactivated");

  // Auto-generate a franchise code if not supplied, unique within company.
  let code = data.code || "";
  if (!code) {
    const count = await prisma.franchise.count({ where: { companyId } });
    code = franchiseCode(company.companyCode, count + 1);
  } else {
    const clash = await prisma.franchise.findFirst({
      where: { companyId, code },
    });
    if (clash) return jsonError(409, "Franchise code already exists in this company");
  }

  const franchise = await prisma.franchise.create({
    data: {
      companyId,
      code,
      name: data.name,
      ownerName: data.ownerName || null,
      email: data.email || null,
      phone: data.phone || null,
      address: data.address || null,
      city: data.city || null,
    },
  });

  await audit(auth, "franchise.create", "Franchise", franchise.id, {
    name: franchise.name,
    code: franchise.code,
    companyId,
  });

  return NextResponse.json({ franchise }, { status: 201 });
}
