import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole, jsonError, scopeOf } from "@/lib/guard";
import { createUserSchema } from "@/lib/validators";
import { hashPassword } from "@/lib/password";
import { audit } from "@/lib/audit";

/** List users visible to the caller. Password hashes are never selected. */
export async function GET() {
  const auth = await requireRole(["SUPER_ADMIN", "COMPANY_ADMIN"]);
  if (auth instanceof NextResponse) return auth;

  const scope = scopeOf(auth);
  const where = scope.kind === "all" ? {} : { companyId: scope.companyId };

  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      company: { select: { id: true, name: true, companyCode: true } },
      franchise: { select: { id: true, name: true, code: true } },
    },
  });
  return NextResponse.json({ users });
}

/** Create a user.
 *  - SUPER_ADMIN: company admins (any company) or franchise users.
 *  - COMPANY_ADMIN: franchise users of own company only.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(["SUPER_ADMIN", "COMPANY_ADMIN"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const data = parsed.data;

  // Tenancy rules for who can be created.
  const companyId = auth.role === "SUPER_ADMIN" ? data.companyId : auth.companyId;
  if (!companyId) return jsonError(400, "Company is required");
  if (auth.role === "COMPANY_ADMIN" && data.role !== "FRANCHISE_USER") {
    return jsonError(403, "Company admins can only create franchise users");
  }
  if (auth.role === "COMPANY_ADMIN" && data.companyId !== auth.companyId) {
    return jsonError(403, "Cannot create users outside your company");
  }

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return jsonError(404, "Company not found");

  if (data.role === "FRANCHISE_USER") {
    if (!data.franchiseId) return jsonError(400, "Franchise is required for franchise users");
    const franchise = await prisma.franchise.findFirst({
      where: { id: data.franchiseId, companyId },
    });
    if (!franchise) return jsonError(404, "Franchise not found in this company");
  }

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) return jsonError(409, "A user with this email already exists");

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash: hashPassword(data.password),
      role: data.role,
      companyId,
      franchiseId: data.role === "FRANCHISE_USER" ? data.franchiseId : null,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      company: { select: { id: true, name: true, companyCode: true } },
      franchise: { select: { id: true, name: true, code: true } },
    },
  });

  await audit(auth, "user.create", "User", user.id, {
    email: user.email,
    role: user.role,
    companyId,
  });

  return NextResponse.json({ user }, { status: 201 });
}
