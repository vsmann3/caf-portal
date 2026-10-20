import { NextResponse, type NextRequest } from "next/server";
import { requireRole, jsonError } from "@/lib/guard";
import { getPortalSettings, portalSettingsSchema, savePortalSettings } from "@/lib/portal-settings";
import { audit } from "@/lib/audit";

export async function GET() {
  const auth = await requireRole(["SUPER_ADMIN"]);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ portal: await getPortalSettings() }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole(["SUPER_ADMIN"]);
  if (auth instanceof NextResponse) return auth;
  const parsed = portalSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message || "Invalid settings");
  await savePortalSettings(parsed.data);
  await audit(auth, "settings.portal.update", "SystemSetting", "portal.general");
  return NextResponse.json({ portal: parsed.data });
}
