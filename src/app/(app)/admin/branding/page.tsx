import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { BrandingClient } from "./branding-client";

export default async function BrandingPage() {
  const session = await getSession();
  if (!session || session.role !== "SUPER_ADMIN") redirect("/dashboard");

  return (
    <div>
      <PageHeader
        title="White-labeling & Branding"
        subtitle="Set per-company custom domain and branding. Domains must be pointed to this server (CNAME/A record)."
      />
      <BrandingClient />
    </div>
  );
}
