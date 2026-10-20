import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { scopeOf } from "@/lib/guard";
import { PageHeader, Badge, EmptyState } from "@/components/ui";
import { DeactivateButton } from "./deactivate-button";

export default async function FranchisesPage() {
  const session = await getSession();
  if (!session || session.role === "FRANCHISE_USER") redirect("/dashboard");

  const scope = scopeOf(session);
  const franchises = await prisma.franchise.findMany({
    where: scope.kind === "all" ? {} : { companyId: scope.companyId },
    orderBy: { createdAt: "desc" },
    include: {
      company: { select: { name: true, companyCode: true } },
      _count: { select: { users: true, applications: true } },
    },
  });

  return (
    <div>
      <PageHeader
        title="Franchises"
        subtitle="Franchise counters under your company (or all companies, for super admin)."
        action={
          <Link href="/admin/franchises/new" className="btn-primary">+ New Franchise</Link>
        }
      />

      {franchises.length === 0 ? (
        <EmptyState message="No franchises yet." />
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">Franchise</th>
                <th className="table-th">Code</th>
                {scope.kind === "all" && <th className="table-th">Company</th>}
                <th className="table-th">Owner</th>
                <th className="table-th">City</th>
                <th className="table-th">Users</th>
                <th className="table-th">CAFs</th>
                <th className="table-th">Status</th>
                <th className="table-th">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {franchises.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50">
                  <td className="table-td font-medium text-slate-900">{f.name}</td>
                  <td className="table-td"><Badge color="blue">{f.code}</Badge></td>
                  {scope.kind === "all" && (
                    <td className="table-td text-slate-500">{f.company.name}</td>
                  )}
                  <td className="table-td">{f.ownerName || "—"}</td>
                  <td className="table-td">{f.city || "—"}</td>
                  <td className="table-td">{f._count.users}</td>
                  <td className="table-td">{f._count.applications}</td>
                  <td className="table-td">
                    {f.isActive ? <Badge color="green">Active</Badge> : <Badge color="red">Inactive</Badge>}
                  </td>
                  <td className="table-td">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/admin/franchises/${f.id}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        Edit
                      </Link>
                      {f.isActive && <DeactivateButton id={f.id} name={f.name} />}
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
