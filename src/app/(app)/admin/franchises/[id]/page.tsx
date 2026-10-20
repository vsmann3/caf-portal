import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { FranchiseForm } from "../franchise-form";

export default async function EditFranchisePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session || session.role === "FRANCHISE_USER") redirect("/dashboard");
  const { id } = await params;

  const franchise = await prisma.franchise.findFirst({
    where: {
      id,
      // Company admins may only touch own company's franchises.
      ...(session.role === "COMPANY_ADMIN" && session.companyId ? { companyId: session.companyId } : {}),
    },
  });
  if (!franchise) notFound();

  const companies =
    session.role === "SUPER_ADMIN"
      ? await prisma.company.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, companyCode: true },
        })
      : undefined;

  return (
    <div>
      <PageHeader title={`Edit ${franchise.name}`} subtitle={`Code: ${franchise.code}`} />
      <FranchiseForm
        companies={companies}
        lockedCompanyId={session.role === "COMPANY_ADMIN" ? session.companyId ?? undefined : undefined}
        initial={{
          id: franchise.id,
          companyId: franchise.companyId,
          name: franchise.name,
          code: franchise.code,
          ownerName: franchise.ownerName ?? "",
          email: franchise.email ?? "",
          phone: franchise.phone ?? "",
          address: franchise.address ?? "",
          city: franchise.city ?? "",
        }}
      />
    </div>
  );
}
