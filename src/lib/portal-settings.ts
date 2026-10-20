import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const portalSettingsSchema = z.object({
  name: z.string().trim().min(1, "Portal name is required").max(100),
  publicUrl: z.string().trim().url("Enter the full portal URL").refine(value => {
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }, "Use an HTTP or HTTPS portal URL without credentials, query or fragment"),
  supportEmail: z.string().trim().email().or(z.literal("")),
}).strict();

export type PortalSettings = z.infer<typeof portalSettingsSchema>;

export async function getPortalSettings(): Promise<PortalSettings> {
  const row = await prisma.systemSetting.findUnique({ where: { key: "portal.general" } });
  return row ? portalSettingsSchema.parse(row.value) : {
    name: "CAF Portal", publicUrl: process.env.APP_URL || "http://localhost:3000", supportEmail: "",
  };
}

export async function savePortalSettings(settings: PortalSettings) {
  await prisma.systemSetting.upsert({ where: { key: "portal.general" },
    create: { key: "portal.general", value: settings }, update: { value: settings } });
}
