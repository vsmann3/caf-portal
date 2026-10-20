import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole, jsonError } from "@/lib/guard";
import { createCompanySchema } from "@/lib/validators";
import { isValidCompanyCode, suggestCompanyCode } from "@/lib/codes";
import { audit } from "@/lib/audit";

/** List companies. Super admin sees all; company admins see their own. */
export async function GET() {
  const auth = await requireRole(["SUPER_ADMIN", "COMPANY_ADMIN"]);
  if (auth instanceof NextResponse) return auth;

  if (auth.role === "SUPER_ADMIN") {
    const companies = await prisma.company.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { franchises: true, users: true, applications: true } } },
    });
    return NextResponse.json({ companies });
  }

  const company = await prisma.company.findUnique({
    where: { id: auth.companyId! },
    include: { _count: { select: { franchises: true, users: true, applications: true } } },
  });
  return NextResponse.json({ companies: company ? [company] : [] });
}

/** Create a company (super admin only). */
export async function POST(request: NextRequest) {
  const auth = await requireRole(["SUPER_ADMIN"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = createCompanySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const data = parsed.data;

  // Explicit code must be valid and unique; otherwise auto-suggest.
  let code = data.companyCode ?? suggestCompanyCode(data.name);
  if (data.companyCode && !isValidCompanyCode(data.companyCode)) {
    return jsonError(400, "Company code must be 4–12 uppercase letters/digits");
  }
  // Guarantee uniqueness.
  for (let i = 0; i < 10; i++) {
    const existing = await prisma.company.findUnique({ where: { companyCode: code } });
    if (!existing) break;
    if (data.companyCode) return jsonError(409, "Company code already in use");
    code = suggestCompanyCode(data.name);
  }

  const company = await prisma.company.create({
    data: {
      name: data.name,
      companyCode: code,
      contactEmail: data.contactEmail || null,
      contactPhone: data.contactPhone || null,
      address: data.address || null,
    },
  });

  await audit(auth, "company.create", "Company", company.id, {
    name: company.name,
    companyCode: company.companyCode,
  });

  return NextResponse.json({ company }, { status: 201 });
}
