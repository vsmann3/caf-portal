import "server-only";
import { mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { assertSafeKey, StorageError, type StorageProvider, type StoredObject } from "./types";

/**
 * Local-disk storage provider. Files live under a configurable base path
 * (default ./storage). Suitable for on-prem servers; move to S3 later from
 * the super admin panel without re-uploading (bulk migration can be added).
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local" as const;

  constructor(private readonly basePath: string) {
    if (!basePath) throw new StorageError("Local storage basePath is required");
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    const root = path.resolve(this.basePath);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) {
      throw new StorageError(`Resolved path escapes storage root: ${key}`);
    }
    return full;
  }

  async save(key: string, data: Buffer, _contentType: string): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async read(key: string): Promise<StoredObject> {
    const full = this.resolve(key);
    try {
      await stat(full);
    } catch {
      throw new StorageError(`File not found: ${key}`);
    }
    const buffer = await readFile(full);
    // Content type is not persisted alongside the blob on local disk; the
    // caller (document API) serves the mime type recorded in the DB.
    return { buffer, contentType: "application/octet-stream" };
  }

  async remove(key: string): Promise<void> {
    const full = this.resolve(key);
    await rm(full, { force: true });
  }

  async test(): Promise<void> {
    const root = path.resolve(this.basePath);
    await mkdir(root, { recursive: true });
    const probe = path.join(root, ".healthcheck");
    await writeFile(probe, `ok-${Date.now()}`);
    await rm(probe, { force: true });
  }
}
