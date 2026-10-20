import { getPortalSettings } from "@/lib/portal-settings";
import { LoginClient } from "./login-client";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const portal = await getPortalSettings();
  return <LoginClient portalName={portal.name} supportEmail={portal.supportEmail} />;
}
