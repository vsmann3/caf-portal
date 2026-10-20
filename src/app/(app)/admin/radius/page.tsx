import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function RadiusSettingsPage() {
  const session = await getSession();
  if (!session || session.role !== "SUPER_ADMIN") redirect("/dashboard");

  redirect("/admin/super-settings#radius");
}
