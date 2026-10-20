import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { PageHeader, StatCard, StatusBadge, EmptyState } from "@/components/ui";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const isSuper = session.role === "SUPER_ADMIN";
  const isCompany = session.role === "COMPANY_ADMIN";
  const isFranchise = session.role === "FRANCHISE_USER";

  const appWhere = isFranchise
    ? { companyId: session.companyId!, franchiseId: session.franchiseId! }
    : isCompany
      ? { companyId: session.companyId! }
      : {};

  const [
    companyCount,
    franchiseCount,
    userCount,
    totalApps,
    pendingApps,
    approvedApps,
    recentApps,
  ] = await Promise.all([
    isSuper ? prisma.company.count() : Promise.resolve(0),
    isFranchise
      ? Promise.resolve(0)
      : isCompany && session.companyId
        ? prisma.franchise.count({ where: { companyId: session.companyId } })
        : Promise.resolve(0),
    isFranchise
      ? Promise.resolve(0)
      : isCompany && session.companyId
        ? prisma.user.count({ where: { companyId: session.companyId } })
        : Promise.resolve(0),
    prisma.customerApplication.count({ where: appWhere }),
    prisma.customerApplication.count({
      where: { ...appWhere, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
    }),
    prisma.customerApplication.count({ where: { ...appWhere, status: "APPROVED" } }),
    prisma.customerApplication.findMany({
      where: appWhere,
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        franchise: { select: { name: true } },
      },
    }),
  ]);

  const title = isSuper
    ? "Platform Overview"
    : isCompany
      ? "Company Overview"
      : "Franchise Overview";

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={`Welcome back, ${session.name.split(" ")[0]}.`}
        action={
          <Link href="/caf/new" className="btn-primary">
            + New CAF
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isSuper && <StatCard label="Companies" value={companyCount} href="/admin/companies" />}
        {!isFranchise && (
          <StatCard label="Franchises" value={franchiseCount} href="/admin/franchises" />
        )}
        {!isFranchise && <StatCard label="Users" value={userCount} href="/admin/users" />}
        <StatCard label="Total CAFs" value={totalApps} href="/customers" />
        <StatCard label="Pending Review" value={pendingApps} href="/customers?status=SUBMITTED" />
        <StatCard label="Approved" value={approvedApps} href="/customers?status=APPROVED" />
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Recent Applications</h2>
          <Link href="/customers" className="text-sm font-medium text-blue-600 hover:underline">
            View all →
          </Link>
        </div>

        {recentApps.length === 0 ? (
          <EmptyState message="No applications yet. Create your first CAF to get started." />
        ) : (
          <div className="card overflow-hidden">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="table-th">CAF No.</th>
                  <th className="table-th">Customer</th>
                  <th className="table-th">Mobile</th>
                  {!isFranchise && <th className="table-th">Franchise</th>}
                  <th className="table-th">Status</th>
                  <th className="table-th">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {recentApps.map((app) => (
                  <tr key={app.id} className="hover:bg-slate-50">
                    <td className="table-td">
                      <Link
                        href={`/customers/${app.id}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {app.cafNumber}
                      </Link>
                    </td>
                    <td className="table-td">{app.customerName}</td>
                    <td className="table-td">{app.mobile}</td>
                    {!isFranchise && <td className="table-td">{app.franchise.name}</td>}
                    <td className="table-td">
                      <StatusBadge status={app.status} />
                    </td>
                    <td className="table-td text-slate-500">
                      {app.createdAt.toLocaleDateString("en-IN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
