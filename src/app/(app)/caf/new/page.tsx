import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { scopeOf } from "@/lib/guard";
import { CafForm, type FranchiseOption } from "./caf-form";

export default async function NewCafPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const scope = scopeOf(session);

  // Franchise users can ONLY file for their own franchise (locked, no dropdown).
  if (scope.kind === "franchise") {
    const franchise = await prisma.franchise.findUnique({
      where: { id: scope.franchiseId },
      select: { id: true, name: true, code: true },
    });
    return (
      <CafForm
        franchises={franchise ? [{ ...franchise, companyName: "" }] : []}
        lockedFranchiseId={scope.franchiseId}
      />
    );
  }

  const franchises = await prisma.franchise.findMany({
    where: {
      ...(scope.kind === "company" ? { companyId: scope.companyId } : {}),
      isActive: true,
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      company: { select: { name: true } },
    },
  });

  return (
    <CafForm
      franchises={franchises.map((f: any) => ({
        id: f.id,
        name: f.name,
        code: f.code,
        companyName: f.company?.name ?? "",
      }))}
      lockedFranchiseId={null}
    />
  );
}
