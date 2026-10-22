import { NextResponse, type NextRequest } from "next/server";
import { requireRole, jsonError } from "@/lib/guard";
import {
  getRadiusConfig,
  radiusSettingsInput,
  saveRadiusConfig,
} from "@/lib/radius";
import { audit } from "@/lib/audit";

const headers = { "Cache-Control": "no-store" };
export async function GET() {
  const auth = await requireRole(["SUPER_ADMIN"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ radius: await getRadiusConfig() }, { headers });
  } catch {
    return jsonError(500, "Unable to read RADIUS settings");
  }
}
export async function PUT(request: NextRequest) {
  const auth = await requireRole(["SUPER_ADMIN"]);
  if (auth instanceof NextResponse) return auth;
  const parsed = radiusSettingsInput.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return jsonError(400, "Invalid RADIUS settings");
  try {
    const cfg = await saveRadiusConfig(parsed.data);
    await audit(
      auth,
      "settings.radius.update",
      "SystemSetting",
      "radius.config",
      {
        provider: cfg.provider,
        enabled: cfg.enabled,
      },
    );
    return NextResponse.json({ radius: cfg }, { headers });
  } catch {
    return jsonError(500, "Unable to save RADIUS settings");
  }
}
