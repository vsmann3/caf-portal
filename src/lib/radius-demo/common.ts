import "server-only";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { ApiError } from "@/lib/guard";
import type { RadiusDemoBinding } from "@prisma/client";

export function demoEnabled() {
  if (process.env.CAF_RADIUS_DEMO !== "1") return false;
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return (
      /^\/caf_demo_[a-z0-9_]+$/.test(url.pathname) ||
      (process.env.CAF_ISOLATED_TEST === "1" &&
        url.pathname === "/smoke" &&
        /^caf-settings-test-.*-db$/.test(url.hostname))
    );
  } catch {
    return false;
  }
}
export function requireDemo() {
  if (!demoEnabled())
    throw new ApiError(404, "Isolated integration demo is unavailable");
}
export const json = (v: unknown) => JSON.parse(JSON.stringify(v));
export const digest = (v: string) =>
  createHash("sha256").update(v).digest("hex");
export function equalSecret(a: string, b: string) {
  const x = Buffer.from(digest(a)),
    y = Buffer.from(digest(b));
  return timingSafeEqual(x, y);
}
export const uuid = z.string().uuid();
export const positive = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
export const reference = z
  .object({
    id: z.string().min(1).max(128),
    code: z.string().min(1).max(128).optional(),
  })
  .strict();
export const planSchema = z
  .object({
    plan_id: uuid,
    radius_company_id: z.string().regex(/^[1-9][0-9]{4,}$/),
    name: z.string().min(1).max(200),
    version: positive.max(2147483647),
    active: z.literal(true),
    download_kbps: positive,
    upload_kbps: positive,
    validity: z
      .object({
        duration_seconds: positive,
        starts_at: z.literal("activation"),
      })
      .strict(),
    price: z
      .object({
        currency: z.string().regex(/^[A-Z]{3}$/),
        amount_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        minor_unit_exponent: z.number().int().min(0).max(6),
      })
      .strict()
      .optional(),
  })
  .strict();
export const planPageSchema = z
  .object({
    items: z.array(planSchema).max(100),
    has_more: z.boolean(),
    next_cursor: z.string().min(1).max(2048).nullable(),
  })
  .strict()
  .refine((v) => v.has_more === (v.next_cursor !== null));
export const reservationSchema = z
  .object({
    source_id: z.string(),
    customer_id: z.string().regex(/^[1-9][0-9]{9}$/),
    company_ref: reference,
    franchise_ref: reference,
    radius_company_id: z.string(),
    radius_franchise_id: z.string(),
    reservation_id: uuid,
    service_request_id: uuid,
    username: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_.@-]+$/),
    plan_id: uuid,
    plan_version: positive,
    expires_at: z.string().datetime(),
  })
  .strict();
export const receiptSchema = z
  .object({
    schema_version: z.literal("2.0"),
    source_id: z.string(),
    customer_id: z.string().regex(/^[1-9][0-9]{9}$/),
    company_ref: reference,
    franchise_ref: reference,
    radius_company_id: z.string(),
    radius_franchise_id: z.string(),
    provisioning_request_id: uuid,
    event_id: uuid,
    service_request_id: uuid,
    receipt_version: positive,
    receipt_status: z.enum([
      "accepted",
      "processing",
      "applied",
      "ignored",
      "blocked",
      "failed",
      "superseded",
    ]),
    credential_accepted: z.boolean(),
    service_id: uuid.nullable(),
    service_status: z.enum([
      "pending_service_setup",
      "active",
      "blocked",
      "failed",
    ]),
    error: z
      .object({
        code: z.string().max(100),
        message: z.string().max(1000),
        retryable: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) +
            ":" +
            canonicalJson((value as Record<string, unknown>)[key]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function requestHmac(body: unknown) {
  const key = process.env.AUTH_SECRET;
  if (!key) throw new Error("Missing encryption authority");
  return createHmac("sha256", key)
    .update("caf-radius-demo-v2\0" + canonicalJson(body))
    .digest("hex");
}
export async function bindingFor(companyId: string) {
  requireDemo();
  const b = await prisma.radiusDemoBinding.findUnique({ where: { companyId } });
  const c = await prisma.company.findUnique({ where: { id: companyId } });
  if (!b?.active || !c?.isActive)
    throw new ApiError(
      409,
      "This company has no active isolated RADIUS binding",
    );
  return b;
}
export function radiusFranchise(b: RadiusDemoBinding, franchiseId: string) {
  const mappings = b.franchiseMappings as Record<string, string>;
  const value = mappings[franchiseId];
  if (typeof value !== "string" || !/^[1-9][0-9]{4,}$/.test(value))
    throw new ApiError(409, "Franchise binding requires configuration");
  return value;
}
export async function radiusRequest(
  b: RadiusDemoBinding,
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
) {
  requireDemo();
  const url = new URL(b.baseUrl);
  const internal =
    process.env.CAF_RADIUS_DEMO_ALLOW_HTTP === "1" &&
    /^http:$/.test(url.protocol) &&
    /^(radius-demo|127\.0\.0\.1|localhost)$/.test(url.hostname);
  if (
    (!internal && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ApiError(409, "Invalid isolated RADIUS origin");
  let response;
  try {
    response = await fetch(url.origin + path, {
      method,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${decryptSecret(b.tokenEncrypted)}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body !== undefined ? canonicalJson(body) : undefined,
    });
  } catch {
    throw new ApiError(
      503,
      "RADIUS outcome unknown; reconcile before retrying",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(502, "Empty RADIUS response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 250000) {
      await reader.cancel();
      throw new ApiError(502, "RADIUS response exceeded limit");
    }
    chunks.push(part.value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(502, "Invalid RADIUS response");
  }
  return { status: response.status, data };
}
export function remoteError(status: number, value: unknown): never {
  const known = z
    .object({ error: z.object({ code: z.string() }) })
    .safeParse(value);
  const allowed = [
    "username_unavailable",
    "reservation_expired",
    "reservation_binding_conflict",
    "plan_changed",
    "scope_denied",
    "rate_limited",
    "invalid_token",
    "integration_disabled",
  ];
  const code =
    known.success && allowed.includes(known.data.error.code)
      ? known.data.error.code
      : "radius_unavailable";
  throw new ApiError(
    status === 409 ? 409 : status === 429 ? 429 : 502,
    `RADIUS ${code}; no local success was recorded`,
  );
}

// Return context is a navigation hint. Match the actual CAF application's binding,
// never a caller-supplied company or arbitrary callback origin.
export async function safeDemoReturnUrl(companyId: string | undefined, raw: unknown) {
  if (!demoEnabled() || !companyId || typeof raw !== "string" || raw.length > 2048) return undefined;
  const binding = await prisma.radiusDemoBinding.findUnique({ where: { companyId } });
  if (!binding?.active) return undefined;
  try {
    const url = new URL(raw), base = new URL(binding.baseUrl);
    if (url.origin !== base.origin || url.username || url.password || url.search || url.hash) return undefined;
    if (url.pathname !== `/companies/${binding.radiusCompanyId}/users/`) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function acceptsSyntheticDemoActive(binding: { sourceId: string; baseUrl: string }) {
  if (!demoEnabled() || process.env.CAF_RADIUS_DEMO_ACCEPT_SYNTHETIC_ACTIVE !== "1" || process.env.CAF_RADIUS_DEMO_ALLOW_HTTP !== "1" || binding.sourceId !== "caf-portal-demo") return false;
  try {
    const db = new URL(process.env.DATABASE_URL ?? ""), remote = new URL(binding.baseUrl);
    return ["127.0.0.1", "localhost"].includes(db.hostname) && /^\/caf_demo_[a-z0-9_]+$/.test(db.pathname) &&
      ["http://127.0.0.1:18120", "http://localhost:18120"].includes(remote.origin) && !remote.username && !remote.password && !remote.search && !remote.hash && remote.pathname === "/";
  } catch { return false; }
}
