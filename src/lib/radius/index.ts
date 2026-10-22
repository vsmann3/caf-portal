import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import type {
  RadiusConfig,
  RadiusApprovalReference,
  RadiusSettingsView,
} from "./types";
export { radiusBlockedResult } from "./types";

const RADIUS_SETTING_KEY = "radius.config";
const provider = z.enum(["iconwave", "jazznetwork", "custom"]);
const baseUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  });
const header = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9-]*$/);
export const radiusSettingsInput = z
  .object({
    enabled: z.boolean().optional(),
    provider: provider.optional(),
    baseUrl: baseUrl.optional(),
    authHeader: header.optional(),
    usernameField: z
      .string()
      .max(128)
      .regex(/^[A-Za-z0-9_]*$/)
      .optional(),
    timeoutMs: z.number().int().min(1000).max(60000).optional(),
    apiKey: z
      .string()
      .max(4096)
      .refine((v) => !/[\r\n\x00]/.test(v) && !v.startsWith("enc:"))
      .optional(),
    clearApiKey: z.boolean().optional(),
  })
  .strict()
  .refine((v) => !(v.clearApiKey && v.apiKey), "Conflicting secret operations");

type StoredConfig = RadiusConfig & { apiKeyEncrypted?: string };
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
// Allowlist reads too: legacy arbitrary fields must never be echoed to browsers.
function publicConfig(value: unknown): RadiusConfig {
  const v = object(value);
  return {
    enabled: v.enabled === true,
    provider: provider.safeParse(v.provider).success
      ? (v.provider as RadiusConfig["provider"])
      : "custom",
    baseUrl: baseUrl.safeParse(v.baseUrl).success ? (v.baseUrl as string) : "",
    authHeader: header.safeParse(v.authHeader).success
      ? (v.authHeader as string)
      : "",
    usernameField:
      typeof v.usernameField === "string" &&
      /^[A-Za-z0-9_]{0,128}$/.test(v.usernameField)
        ? v.usernameField
        : "",
    timeoutMs:
      typeof v.timeoutMs === "number" &&
      Number.isInteger(v.timeoutMs) &&
      v.timeoutMs >= 1000 &&
      v.timeoutMs <= 60000
        ? v.timeoutMs
        : 10000,
  };
}
function view(value: unknown): RadiusSettingsView {
  const v = object(value);
  return {
    ...publicConfig(v),
    apiKeyConfigured: Boolean(
      v.apiKeyEncrypted || (typeof v.apiKey === "string" && v.apiKey),
    ),
    runtimeStatus: "NOT_IMPLEMENTED" as const,
  };
}
export async function getRadiusConfig() {
  const row = await prisma.systemSetting.findUnique({
    where: { key: RADIUS_SETTING_KEY },
  });
  return view(row?.value);
}
export async function saveRadiusConfig(
  input: z.infer<typeof radiusSettingsInput>,
) {
  return prisma.$transaction(async (tx) => {
    // Serialize secret-preserving partial updates, including the initially absent row.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${RADIUS_SETTING_KEY}))`;
    const row = await tx.systemSetting.findUnique({
      where: { key: RADIUS_SETTING_KEY },
    });
    const old = object(row?.value);
    const { apiKey, clearApiKey, ...fields } = input;
    const cfg: StoredConfig = { ...publicConfig(old), ...fields };
    if (!clearApiKey) {
      if (apiKey) cfg.apiKeyEncrypted = encryptSecret(apiKey);
      else if (typeof old.apiKeyEncrypted === "string" && old.apiKeyEncrypted)
        cfg.apiKeyEncrypted = old.apiKeyEncrypted;
      // Migrate legacy plaintext only on an explicit settings save, never on GET.
      else if (typeof old.apiKey === "string" && old.apiKey)
        cfg.apiKeyEncrypted = encryptSecret(old.apiKey);
    }
    const value = JSON.parse(JSON.stringify(cfg));
    await tx.systemSetting.upsert({
      where: { key: RADIUS_SETTING_KEY },
      update: { value },
      create: { key: RADIUS_SETTING_KEY, value },
    });
    return view(cfg);
  });
}

export function buildRadiusApprovalReference(app: {
  id: string;
  customerId: string;
  companyId: string;
  franchiseId: string;
  cafNumber: string;
  revision: number;
  status: string;
}): RadiusApprovalReference {
  if (app.status !== "APPROVED" || !/^\d{10}$/.test(app.customerId))
    throw new Error("Invalid approved CAF reference");
  return {
    format: "caf-radius-local-reference-v1",
    customer_id: app.customerId,
    company_id: app.companyId,
    franchise_id: app.franchiseId,
    caf: {
      application_id: app.id,
      number: app.cafNumber,
      revision: app.revision,
      status: "APPROVED",
    },
  };
}
