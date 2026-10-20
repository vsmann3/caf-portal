import { NextResponse } from "next/server";
import { clearSessionCookie, getSession } from "@/lib/session";
import { audit } from "@/lib/audit";

export async function POST() {
  const session = await getSession();
  if (session) await audit(session, "auth.logout");
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
