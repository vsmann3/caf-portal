import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { FranchiseForm } from "../franchise-form";

export default async function NewFranchisePage() {
  const session = await getSession();
  if (!session || session.role === "FRANCHISE_USER") redirect("/dashboard");

  // Super admin picks the company; company admins are locked to their own.
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
      <PageHeader title="New Franchise" subtitle="Add a franchise counter under a company." />
      <FranchiseForm
        companies={companies}
        lockedCompanyId={session.role === "COMPANY_ADMIN" ? session.companyId ?? undefined : undefined}
      />
    </div>
  );
}
