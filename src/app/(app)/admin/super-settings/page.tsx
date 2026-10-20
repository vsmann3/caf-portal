import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { SuperSettingsClient } from "./super-settings-client";
import { RadiusClient } from "../radius/radius-client";
import { getPortalSettings } from "@/lib/portal-settings";
import { getSmtpSettings, smtpSettingsView } from "@/lib/email";

export default async function SuperSettingsPage() {
  const session = await getSession();
  if (!session || session.role !== "SUPER_ADMIN") redirect("/dashboard");
  const [portal, smtp] = await Promise.all([getPortalSettings(), getSmtpSettings()]);
  return <div>
    <PageHeader title="Super Settings" subtitle="Manage primary portal settings. Each section is saved separately." />
    <div className="max-w-3xl space-y-4">
      <SuperSettingsClient portal={portal} smtp={smtpSettingsView(smtp)} />
      <details id="radius" className="card group">
        <summary className="cursor-pointer p-5 text-base font-semibold text-slate-900">RADIUS Integration</summary>
        <div className="border-t border-slate-100 p-5"><RadiusClient /></div>
      </details>
    </div>
  </div>;
}
