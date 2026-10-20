import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole, jsonError } from "@/lib/guard";
import { updateCompanySchema } from "@/lib/validators";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

/** Get one company. Super admin: any. Company admin: own only. */
export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireRole(["SUPER_ADMIN", "COMPANY_ADMIN"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  if (auth.role === "COMPANY_ADMIN" && auth.companyId !== id) {
    return jsonError(403, "Not your company");
  }

  const company = await prisma.company.findUnique({
    where: { id },
    include: { _count: { select: { franchises: true, users: true, applications: true } } },
  });
  if (!company) return jsonError(404, "Company not found");
  return NextResponse.json({ company });
}

/** Update a company (super admin only — company admins cannot edit their own
 *  record since company identity is part of the ISP's tenancy registry). */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireRole(["SUPER_ADMIN"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = updateCompanySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const existing = await prisma.company.findUnique({ where: { id } });
  if (!existing) return jsonError(404, "Company not found");

  const { name, companyCode, contactEmail, contactPhone, address, isActive } = parsed.data;

  if (companyCode && companyCode !== existing.companyCode) {
    const clash = await prisma.company.findUnique({ where: { companyCode } });
    if (clash) return jsonError(409, "Company code already in use");
  }

  const company = await prisma.company.update({
    where: { id },
    data: {
      name: name ?? undefined,
      companyCode: companyCode ?? undefined,
      contactEmail: contactEmail === undefined ? undefined : contactEmail || null,
      contactPhone: contactPhone === undefined ? undefined : contactPhone || null,
      address: address === undefined ? undefined : address || null,
      isActive: isActive ?? undefined,
    },
  });

  await audit(auth, "company.update", "Company", id, { changes: parsed.data });
  return NextResponse.json({ company });
}

/** Deactivate (soft) a company — super admin only. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireRole(["SUPER_ADMIN"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const existing = await prisma.company.findUnique({ where: { id } });
  if (!existing) return jsonError(404, "Company not found");

  const company = await prisma.company.update({
    where: { id },
    data: { isActive: false },
  });

  await prisma.user.updateMany({
    where: { companyId: id, role: { not: "SUPER_ADMIN" } },
    data: { isActive: false },
  });

  await audit(auth, "company.deactivate", "Company", id);
  return NextResponse.json({ company });
}
