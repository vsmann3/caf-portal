import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ProfileSettings } from "./profile-settings";
export default async function ProfilePage() {
  if (!(await getSession())) redirect("/login");
  return <ProfileSettings />;
}
