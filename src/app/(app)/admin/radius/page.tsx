import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { RadiusClient } from "./radius-client";

export default async function RadiusSettingsPage() {
  const session = await getSession();
  if (!session || session.role !== "SUPER_ADMIN") redirect("/dashboard");

  return (
    <div>
      <PageHeader
        title="RADIUS Integration"
        subtitle="Push approved CAFs to IconWaveTech/JazzNetwork RADIUS via adapter. API details can be added later."
      />
      <RadiusClient />
    </div>
  );
}
