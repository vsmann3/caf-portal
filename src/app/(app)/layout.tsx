import { demoEnabled } from "@/lib/radius-demo/common";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Sidebar } from "@/components/nav";
import { getPortalSettings } from "@/lib/portal-settings";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const portal = await getPortalSettings();

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
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar
        role={session.role}
        portalName={portal.name}
        userName={session.name}
        companyName={company?.name}
        franchiseName={franchise?.name}
      />
      <main className="min-w-0 flex-1 overflow-x-auto p-4 sm:p-6 lg:p-8">{demoEnabled() && <div className="mb-4 rounded border border-amber-400 bg-amber-50 p-3 text-sm font-semibold">ISOLATED CAF / RADIUS DEMO - synthetic customers only; no real network activation</div>}{children}</main>
    </div>
  );
}
