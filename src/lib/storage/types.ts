// Pluggable document storage abstraction.
// v1 ships "local" (disk) and "s3" (any S3-compatible endpoint incl. MinIO).
// Adding a future provider (e.g. a cloud KMS-backed vault) = implement this
// interface and register it in ./index.ts.

export interface StoredObject {
  buffer: Buffer;
  contentType: string;
}

export interface StorageProvider {
  readonly name: "local" | "s3";
  /** Store bytes under a provider-relative key. Must be idempotent-safe (overwrite OK). */
  save(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Read bytes back. Throws if the key does not exist. */
  read(key: string): Promise<StoredObject>;
  /** Delete bytes. Must not throw if the key is already missing. */
  remove(key: string): Promise<void>;
  /** Cheap health probe used by the admin panel test button. */
  test(): Promise<void>;
}

export class StorageError extends Error {}

/** Reject keys that could escape the storage root (path traversal). */
export function assertSafeKey(key: string): void {
  if (
    !key ||
    key.startsWith("/") ||
    key.includes("..") ||
    key.includes("\\") ||
    key.includes("\0")
  ) {
    throw new StorageError(`Unsafe storage key: ${key}`);
  }
}
