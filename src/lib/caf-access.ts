import "server-only";
import { prisma } from "@/lib/db";
import { scopeOf } from "@/lib/guard";
import type { SessionPayload } from "@/lib/session";
import type { Prisma } from "@prisma/client";

export function applicationScope(auth: SessionPayload) {
  const scope = scopeOf(auth);
  return scope.kind === "all"
    ? {}
    : scope.kind === "company"
      ? { companyId: scope.companyId }
      : { companyId: scope.companyId, franchiseId: scope.franchiseId };
}

export async function filingFranchise(auth: SessionPayload, id: string) {
  if (auth.role === "FRANCHISE_USER" && id !== auth.franchiseId) return null;
  return prisma.franchise.findFirst({
    where: {
      id,
      ...(auth.role !== "SUPER_ADMIN"
        ? { companyId: auth.companyId ?? "" }
        : {}),
      isActive: true,
      company: { isActive: true },
    },
    include: { company: true },
  });
}

export async function availableUsername(
  companyId: string,
  candidates: string[],
  excludeId?: string,
  client: Prisma.TransactionClient = prisma,
) {
  for (const name of candidates) {
    const existing = await client.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "CustomerApplication"
      WHERE "companyId" = ${companyId}
      AND LOWER(BTRIM("broadbandUsername")) = ${name}
      AND (${excludeId ?? null}::text IS NULL OR "id" <> ${excludeId ?? null}) LIMIT 1`;
    if (!existing.length) return name;
  }
  return null;
}
