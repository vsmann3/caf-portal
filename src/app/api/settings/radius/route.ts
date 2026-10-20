import { NextResponse, type NextRequest } from "next/server";
import { requireRole, jsonError } from "@/lib/guard";
import { getRadiusConfig, defaultRadiusConfig } from "@/lib/radius";

export async function GET() {
  const auth = await requireRole(["SUPER_ADMIN"]);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ radius: await getRadiusConfig() });
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole(["SUPER_ADMIN"]);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonError(400, "Invalid body");
  const cfg = { ...defaultRadiusConfig(), ...body } as any;
  const { prisma } = await import("@/lib/db");
  const { audit } = await import("@/lib/audit");
  await prisma.systemSetting.upsert({
    where: { key: "radius.config" },
    update: { value: cfg },
    create: { key: "radius.config", value: cfg },
  });
  await audit(auth, "settings.radius.update", "SystemSetting", "radius.config", {
    provider: cfg.provider,
    enabled: cfg.enabled,
  });
  return NextResponse.json({ radius: cfg });
}
