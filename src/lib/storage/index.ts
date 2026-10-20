import "server-only";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { LocalStorageProvider } from "./local";
import { S3StorageProvider, type S3Config } from "./s3";
import type { StorageProvider } from "./types";
import type { Prisma } from "@prisma/client";

export const STORAGE_SETTING_KEY = "storage.config";

export interface StorageConfig {
  provider: "local" | "s3";
  local: { basePath: string };
  s3?: {
    bucket: string;
    region: string;
    endpoint?: string;
    accessKeyId: string;
    /** Stored encrypted (enc:... format) in the DB. */
    secretAccessKey: string;
    forcePathStyle?: boolean;
  };
}

/** Config as returned to the super admin API — secrets masked. */
export interface StorageConfigView extends Omit<StorageConfig, "s3"> {
  s3?: Omit<NonNullable<StorageConfig["s3"]>, "secretAccessKey"> & {
    secretAccessKey: string; // replaced with "***" before sending
  };
}

export function defaultStorageConfig(): StorageConfig {
  return {
    provider: (process.env.STORAGE_DEFAULT as "local" | "s3") || "local",
    local: { basePath: process.env.LOCAL_STORAGE_PATH || "./storage" },
  };
}

export async function getStorageConfig(): Promise<StorageConfig> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: STORAGE_SETTING_KEY },
  });
  if (!row) return defaultStorageConfig();
  return row.value as unknown as StorageConfig;
}

/**
 * Persist storage config. The S3 secret key is encrypted at rest using
 * AUTH_SECRET before hitting the database.
 */
export async function setStorageConfig(config: StorageConfig): Promise<void> {
  const toStore: StorageConfig = {
    ...config,
    s3: config.s3
      ? { ...config.s3, secretAccessKey: encryptSecret(config.s3.secretAccessKey) }
      : undefined,
  };
  await prisma.systemSetting.upsert({
    where: { key: STORAGE_SETTING_KEY },
    update: { value: toStore as unknown as Prisma.InputJsonValue },
    create: { key: STORAGE_SETTING_KEY, value: toStore as unknown as Prisma.InputJsonValue },
  });
  cached = { config, at: Date.now() };
}

/** View model for the admin panel: secret masked. */
export async function getStorageConfigView(): Promise<StorageConfigView> {
  const config = await getStorageConfig();
  return {
    ...config,
    s3: config.s3
      ? { ...config.s3, secretAccessKey: config.s3.secretAccessKey ? "***" : "" }
      : undefined,
  };
}

/**
 * Build a provider instance from the effective config.
 *
 * NOTE for migration: keys already written by a previous provider keep their
 * `storageProvider` snapshot on the Document row, and the document API reads
 * through the provider recorded at upload time — so switching providers for
 * new uploads never orphans old files.
 */
export function buildProvider(config: StorageConfig): StorageProvider {
  if (config.provider === "s3") {
    if (!config.s3) throw new Error("S3 storage selected but not configured");
    const s3: S3Config = {
      bucket: config.s3.bucket,
      region: config.s3.region,
      endpoint: config.s3.endpoint,
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: decryptSecret(config.s3.secretAccessKey),
      forcePathStyle: config.s3.forcePathStyle,
    };
    return new S3StorageProvider(s3);
  }
  return new LocalStorageProvider(config.local.basePath);
}

// 30s cache so per-request storage resolution does not hammer the DB.
let cached: { config: StorageConfig; at: number } | null = null;
const CACHE_TTL_MS = 30_000;

export async function getActiveProvider(): Promise<StorageProvider> {
  if (!cached || Date.now() - cached.at > CACHE_TTL_MS) {
    cached = { config: await getStorageConfig(), at: Date.now() };
  }
  return buildProvider(cached.config);
}

/**
 * Provider for a *specific* document, honoring the provider snapshot recorded
 * at upload time. Switching the active provider later never orphans files
 * uploaded under the previous one.
 */
export async function getProviderFor(storageProviderName?: string | null): Promise<StorageProvider> {
  const config = await getStorageConfig();
  if (storageProviderName === "s3") {
    return buildProvider({ ...config, provider: "s3" });
  }
  // "local" (default): use the configured local base path for reads.
  return new LocalStorageProvider(config.local.basePath);
}
