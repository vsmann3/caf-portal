import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { CompanyForm } from "../company-form";

export default async function EditCompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session || session.role !== "SUPER_ADMIN") redirect("/dashboard");
  const { id } = await params;

  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) notFound();

  return (
    <div>
      <PageHeader
        title={`Edit ${company.name}`}
        subtitle={`Company code: ${company.companyCode}`}
      />
      <CompanyForm
        initial={{
          id: company.id,
          name: company.name,
          companyCode: company.companyCode,
          contactEmail: company.contactEmail ?? "",
          contactPhone: company.contactPhone ?? "",
          address: company.address ?? "",
        }}
      />
    </div>
  );
}
