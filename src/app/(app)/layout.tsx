import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Sidebar } from "@/components/nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const [company, franchise] = await Promise.all([
    session.companyId
      ? prisma.company.findUnique({
          where: { id: session.companyId },
          select: { name: true, isActive: true },
        })
      : Promise.resolve(null),
    session.franchiseId
      ? prisma.franchise.findUnique({
          where: { id: session.franchiseId },
          select: { name: true, isActive: true },
        })
      : Promise.resolve(null),
  ]);

  // Lock out users of deactivated tenants immediately.
  if ((company && !company.isActive) || (franchise && !franchise.isActive)) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        role={session.role}
        userName={session.name}
        companyName={company?.name}
        franchiseName={franchise?.name}
      />
      <main className="flex-1 overflow-x-auto p-6 lg:p-8">{children}</main>
    </div>
  );
}
