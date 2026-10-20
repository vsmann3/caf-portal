import "server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { assertSafeKey, StorageError, type StorageProvider, type StoredObject } from "./types";

export interface S3Config {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

/**
 * S3-compatible storage provider. Works with AWS S3, MinIO, DigitalOcean
 * Spaces, Wasabi, etc. — just point `endpoint` at the service.
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = "s3" as const;
  private client: S3Client;

  constructor(private readonly config: S3Config) {
    if (!config.bucket) throw new StorageError("S3 bucket is required");
    this.client = new S3Client({
      region: config.region || "us-east-1",
      endpoint: config.endpoint || undefined,
      forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async save(key: string, data: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
  }

  async read(key: string): Promise<StoredObject> {
    assertSafeKey(key);
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) throw new StorageError(`Empty response for key: ${key}`);
      return {
        buffer: Buffer.from(bytes),
        contentType: res.ContentType ?? "application/octet-stream",
      };
    } catch (e) {
      if (e instanceof StorageError) throw e;
      throw new StorageError(
        `S3 read failed for ${key}: ${(e as Error).message}`,
      );
    }
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }

  async test(): Promise<void> {
    // A Put+Delete of a tiny probe object verifies credentials + permissions.
    const probeKey = ".healthcheck";
    await this.save(probeKey, Buffer.from(`ok-${Date.now()}`), "text/plain");
    await this.remove(probeKey);
  }
}
