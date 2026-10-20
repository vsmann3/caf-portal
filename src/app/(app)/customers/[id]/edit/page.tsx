import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { applicationScope } from "@/lib/caf-access";
import { CafForm } from "@/app/(app)/caf/new/caf-form";

export default async function EditCaf({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await getSession();
  if (!auth) redirect("/login");
  const { id } = await params;
  const app = await prisma.customerApplication.findFirst({
    where: { id, ...applicationScope(auth) },
    include: { documents: true, franchise: true, company: true },
  });
  if (!app) notFound();
  if (app.status !== "REJECTED") redirect(`/customers/${id}`);
  const initial: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(app))
    if (typeof value === "string") initial[key] = value;
  initial.dob = app.dob?.toISOString().slice(0, 10) ?? "";
  initial.billingSame = !app.billingAddressLine1;
  return (
    <CafForm
      franchises={[
        {
          id: app.franchise.id,
          name: app.franchise.name,
          code: app.franchise.code,
          companyName: app.company.name,
        },
      ]}
      lockedFranchiseId={app.franchiseId}
      initial={initial}
      initialDocuments={app.documents}
      applicationId={app.id}
      revision={app.revision}
    />
  );
}
