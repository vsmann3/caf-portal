import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole, jsonError, scopeOf } from "@/lib/guard";
import { updateUserSchema } from "@/lib/validators";
import { hashPassword } from "@/lib/password";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

const select = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
  company: { select: { id: true, name: true, companyCode: true } },
  franchise: { select: { id: true, name: true, code: true } },
} as const;

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireRole(["SUPER_ADMIN", "COMPANY_ADMIN"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const scope = scopeOf(auth);
  const existing = await prisma.user.findFirst({
    where: {
      id,
      ...(scope.kind === "all" ? {} : { companyId: scope.companyId }),
    },
  });
  if (!existing) return jsonError(404, "User not found");
  if (existing.role === "SUPER_ADMIN" && auth.role !== "SUPER_ADMIN") {
    return jsonError(403, "Cannot modify a super admin");
  }

  const d = parsed.data;

  if (d.email && d.email !== existing.email) {
    const clash = await prisma.user.findUnique({ where: { email: d.email } });
    if (clash) return jsonError(409, "Email already in use");
  }

  // Moving a franchise user to another franchise must stay in the same company.
  if (d.franchiseId !== undefined && d.franchiseId !== null) {
    const franchise = await prisma.franchise.findFirst({
      where: { id: d.franchiseId, companyId: existing.companyId ?? "" },
    });
    if (!franchise) return jsonError(404, "Franchise not found in this company");
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      name: d.name ?? undefined,
      email: d.email ?? undefined,
      passwordHash: d.password ? hashPassword(d.password) : undefined,
      ...(d.email && d.email !== existing.email ? { emailVerifiedAt: null } : {}),
      ...(d.password || (d.email && d.email !== existing.email) ? { sessionVersion: { increment: 1 } } : {}),
      isActive: d.isActive ?? undefined,
      franchiseId:
        existing.role === "FRANCHISE_USER"
          ? d.franchiseId === undefined
            ? undefined
            : d.franchiseId
          : undefined,
    },
    select,
  });

  await audit(auth, "user.update", "User", id, {
    email: user.email,
    changes: { ...d, password: d.password ? "(changed)" : undefined },
  });

  return NextResponse.json({ user });
}

/** Deactivate a user (soft). */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireRole(["SUPER_ADMIN", "COMPANY_ADMIN"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  if (id === auth.userId) return jsonError(400, "You cannot deactivate your own account");

  const scope = scopeOf(auth);
  const existing = await prisma.user.findFirst({
    where: {
      id,
      ...(scope.kind === "all" ? {} : { companyId: scope.companyId }),
    },
  });
  if (!existing) return jsonError(404, "User not found");
  if (existing.role === "SUPER_ADMIN") {
    return jsonError(403, "Cannot deactivate a super admin");
  }

  const user = await prisma.user.update({
    where: { id },
    data: { isActive: false },
    select,
  });
  await audit(auth, "user.deactivate", "User", id, { email: user.email });
  return NextResponse.json({ user });
}
