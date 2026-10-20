import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { scopeOf } from "@/lib/guard";
import { PageHeader, StatusBadge, EmptyState } from "@/components/ui";

const STATUSES = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"] as const;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;

  const scope = scopeOf(session);
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const pageSize = 20;

  const where: Record<string, unknown> = {};
  if (scope.kind === "company") where.companyId = scope.companyId;
  if (scope.kind === "franchise") {
    where.companyId = scope.companyId;
    where.franchiseId = scope.franchiseId;
  }
  if (status) where.status = status;
  if (q) {
    where.OR = [
      { customerName: { contains: q, mode: "insensitive" } },
      { mobile: { contains: q } },
      { cafNumber: { contains: q, mode: "insensitive" } },
      { idNumber: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, items, franchises] = await Promise.all([
    prisma.customerApplication.count({ where }),
    prisma.customerApplication.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        franchise: { select: { name: true } },
        _count: { select: { documents: true } },
      },
    }),
    // Franchise filter dropdown (company admin / super admin only)
    scope.kind !== "franchise"
      ? prisma.franchise.findMany({
          where: scope.kind === "company" ? { companyId: scope.companyId } : {},
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canFilterFranchise = scope.kind !== "franchise";

  function href(params: Record<string, string | number | undefined>) {
    const u = new URLSearchParams();
    const merged = { q, status, page: "", franchiseId: typeof sp.franchiseId === "string" ? sp.franchiseId : "", ...params };
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== "") u.set(k, String(v));
    }
    const s = u.toString();
    return s ? `?${s}` : "?";
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={`${total} application${total === 1 ? "" : "s"} ${q || status ? "matching filter" : "on record"}.`}
        action={
          <Link href="/caf/new" className="btn-primary">
            + New CAF
          </Link>
        }
      />

      <form method="get" className="card mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-52 flex-1">
          <label className="field-label" htmlFor="q">Search</label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="Name, mobile, CAF number, ID number…"
            className="field-input"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={status} className="field-input w-44">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s.replaceAll("_", " ")}</option>
            ))}
          </select>
        </div>
        {canFilterFranchise && franchises.length > 0 && (
          <div>
            <label className="field-label" htmlFor="franchiseId">Franchise</label>
            <select
              id="franchiseId"
              name="franchiseId"
              defaultValue={typeof sp.franchiseId === "string" ? sp.franchiseId : ""}
              className="field-input w-52"
            >
              <option value="">All franchises</option>
              {franchises.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        )}
        <button type="submit" className="btn-secondary">Filter</button>
        {(q || status) && (
          <Link href="/customers" className="btn-secondary">Reset</Link>
        )}
      </form>

      {items.length === 0 ? (
        <EmptyState message="No applications found." />
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">CAF No.</th>
                <th className="table-th">Customer</th>
                <th className="table-th">Mobile</th>
                <th className="table-th">City</th>
                {canFilterFranchise && <th className="table-th">Franchise</th>}
                <th className="table-th">Type</th>
                <th className="table-th">Docs</th>
                <th className="table-th">Status</th>
                <th className="table-th">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {items.map((app) => (
                <tr key={app.id} className="hover:bg-slate-50">
                  <td className="table-td">
                    <Link
                      href={`/customers/${app.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {app.cafNumber}
                    </Link>
                  </td>
                  <td className="table-td font-medium text-slate-900">{app.customerName}</td>
                  <td className="table-td">{app.mobile}</td>
                  <td className="table-td">{app.city}</td>
                  {canFilterFranchise && <td className="table-td">{app.franchise.name}</td>}
                  <td className="table-td">{app.connectionType.replaceAll("_", " ")}</td>
                  <td className="table-td">{app._count.documents}</td>
                  <td className="table-td"><StatusBadge status={app.status} /></td>
                  <td className="table-td text-slate-500">
                    {app.createdAt.toLocaleDateString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
              <p className="text-sm text-slate-500">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link href={href({ page: page - 1 })} className="btn-secondary">Previous</Link>
                )}
                {page < totalPages && (
                  <Link href={href({ page: page + 1 })} className="btn-secondary">Next</Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
