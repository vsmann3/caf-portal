import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { PageHeader, Badge, EmptyState } from "@/components/ui";
import { DeactivateButton } from "./deactivate-button";

export default async function CompaniesPage() {
  const session = await getSession();
  if (!session || session.role !== "SUPER_ADMIN") redirect("/dashboard");

  const companies = await prisma.company.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { franchises: true, users: true, applications: true } } },
  });

  return (
    <div>
      <PageHeader
        title="Companies"
        subtitle="Tenants on the platform. Each company gets a unique company code."
        action={
          <Link href="/admin/companies/new" className="btn-primary">+ New Company</Link>
        }
      />

      {companies.length === 0 ? (
        <EmptyState message="No companies yet. Create your first company to get started." />
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">Company</th>
                <th className="table-th">Code</th>
                <th className="table-th">Contact</th>
                <th className="table-th">Franchises</th>
                <th className="table-th">Users</th>
                <th className="table-th">CAFs</th>
                <th className="table-th">Status</th>
                <th className="table-th">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {companies.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="table-td font-medium text-slate-900">{c.name}</td>
                  <td className="table-td">
                    <Badge color="blue">{c.companyCode}</Badge>
                  </td>
                  <td className="table-td text-slate-500">
                    {c.contactEmail || "—"}
                    {c.contactPhone && <span className="block">{c.contactPhone}</span>}
                  </td>
                  <td className="table-td">{c._count.franchises}</td>
                  <td className="table-td">{c._count.users}</td>
                  <td className="table-td">{c._count.applications}</td>
                  <td className="table-td">
                    {c.isActive ? <Badge color="green">Active</Badge> : <Badge color="red">Inactive</Badge>}
                  </td>
                  <td className="table-td">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/admin/companies/${c.id}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        Edit
                      </Link>
                      {c.isActive && <DeactivateButton id={c.id} name={c.name} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
