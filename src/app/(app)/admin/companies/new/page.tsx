import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { CompanyForm } from "../company-form";

export default async function NewCompanyPage() {
  const session = await getSession();
  if (!session || session.role !== "SUPER_ADMIN") redirect("/dashboard");

  return (
    <div>
      <PageHeader title="New Company" subtitle="Register a new tenant company." />
      <CompanyForm />
    </div>
  );
}
