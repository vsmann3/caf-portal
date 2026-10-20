import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole, jsonError } from "@/lib/guard";
import { getSmtpSettings, smtpSettingsView, smtpSettingsSchema, saveSmtpSettings, sendTestEmail } from "@/lib/email";
import { audit } from "@/lib/audit";

export async function GET() {
  const auth = await requireRole(["SUPER_ADMIN"]);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ smtp: smtpSettingsView(await getSmtpSettings()) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole(["SUPER_ADMIN"]);
  if (auth instanceof NextResponse) return auth;
  const parsed = smtpSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message || "Invalid settings");
  try {
    const smtp = await saveSmtpSettings(parsed.data);
    await audit(auth, "settings.smtp.update", "SystemSetting", "portal.smtp", { enabled: smtp.enabled });
    return NextResponse.json({ smtp });
  } catch {
    return jsonError(400, "Unable to save SMTP settings. Check the host, sender, authentication details and saved password.");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(["SUPER_ADMIN"]);
  if (auth instanceof NextResponse) return auth;
  const parsed = z.object({ to: z.string().trim().email() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Enter a valid test recipient email");
  try {
    await sendTestEmail(parsed.data.to);
    await audit(auth, "settings.smtp.test", "SystemSetting", "portal.smtp", { status: "sent" });
    return NextResponse.json({ message: "Test email accepted by the SMTP server. Check the recipient inbox." });
  } catch {
    await audit(auth, "settings.smtp.test", "SystemSetting", "portal.smtp", { status: "failed" });
    return jsonError(502, "Test email failed. Check saved SMTP settings, credentials, TLS mode and server connectivity.");
  }
}
