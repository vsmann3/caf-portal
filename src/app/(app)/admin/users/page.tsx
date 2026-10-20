import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { UsersClient } from "./users-client";

export default async function UsersPage() {
  const session = await getSession();
  if (!session || session.role === "FRANCHISE_USER") redirect("/dashboard");

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Company admins and franchise users under your organization."
      />
      <UsersClient isSuper={session.role === "SUPER_ADMIN"} />
    </div>
  );
}
