import { safeDemoReturnUrl } from "@/lib/radius-demo/common";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { scopeOf } from "@/lib/guard";
import { CafForm, type FranchiseOption } from "./caf-form";

export default async function NewCafPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const prefill =
    typeof query.companyId === "string" ? query.companyId : typeof query.company_id === "string" ? query.company_id : undefined;
  const session = await getSession();
  if (!session) redirect("/login");

  const scope = scopeOf(session);

  // Franchise users can ONLY file for their own franchise (locked, no dropdown).
  if (scope.kind === "franchise") {
    const franchise = await prisma.franchise.findUnique({
      where: { id: scope.franchiseId },
      select: { id: true, companyId: true, name: true, code: true },
    });
    return (
      <CafForm
        franchises={franchise ? [{ ...franchise, companyName: "" }] : []}
        returnTo={await safeDemoReturnUrl(franchise?.companyId, query.returnTo)}
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
      companyId: true,
      name: true,
      code: true,
      company: { select: { name: true } },
    },
  });

  // A RADIUS prefill is a selection hint only, never an authorization grant.
  const ordered = prefill
    ? [
        ...franchises.filter((f) => f.companyId === prefill),
        ...franchises.filter((f) => f.companyId !== prefill),
      ]
    : franchises;
  return (
    <CafForm
      franchises={ordered.map((f: any) => ({
        id: f.id,
        name: f.name,
        code: f.code,
        companyName: f.company?.name ?? "",
      }))}
      returnTo={await safeDemoReturnUrl(ordered[0]?.companyId, query.returnTo)}
      lockedFranchiseId={null}
    />
  );
}
