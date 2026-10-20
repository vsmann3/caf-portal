import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole, jsonError, scopeOf } from "@/lib/guard";
import { updateFranchiseSchema } from "@/lib/validators";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

async function findScoped(id: string, companyId?: string) {
  return prisma.franchise.findFirst({
    where: companyId ? { id, companyId } : { id },
  });
}

export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireRole(["SUPER_ADMIN", "COMPANY_ADMIN", "FRANCHISE_USER"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const scope = scopeOf(auth);
  const franchise = await findScoped(
    id,
    scope.kind === "all" ? undefined : scope.companyId,
  );
  if (!franchise) return jsonError(404, "Franchise not found");
  return NextResponse.json({ franchise });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireRole(["SUPER_ADMIN", "COMPANY_ADMIN"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = updateFranchiseSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const scope = scopeOf(auth);
  const existing = await findScoped(
    id,
    scope.kind === "all" ? undefined : scope.companyId,
  );
  if (!existing) return jsonError(404, "Franchise not found");

  const d = parsed.data;
  const franchise = await prisma.franchise.update({
    where: { id },
    data: {
      name: d.name ?? undefined,
      code: d.code || undefined,
      ownerName: d.ownerName === undefined ? undefined : d.ownerName || null,
      email: d.email === undefined ? undefined : d.email || null,
      phone: d.phone === undefined ? undefined : d.phone || null,
      address: d.address === undefined ? undefined : d.address || null,
      city: d.city === undefined ? undefined : d.city || null,
      isActive: d.isActive ?? undefined,
    },
  });

  await audit(auth, "franchise.update", "Franchise", id, { changes: parsed.data });
  return NextResponse.json({ franchise });
}

/** Deactivate a franchise (soft). */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireRole(["SUPER_ADMIN", "COMPANY_ADMIN"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const scope = scopeOf(auth);
  const existing = await findScoped(
    id,
    scope.kind === "all" ? undefined : scope.companyId,
  );
  if (!existing) return jsonError(404, "Franchise not found");

  const franchise = await prisma.franchise.update({
    where: { id },
    data: { isActive: false },
  });
  await prisma.user.updateMany({
    where: { franchiseId: id },
    data: { isActive: false },
  });

  await audit(auth, "franchise.deactivate", "Franchise", id);
  return NextResponse.json({ franchise });
}
