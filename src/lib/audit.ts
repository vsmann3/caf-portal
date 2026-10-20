import "server-only";
import { prisma } from "@/lib/db";
import type { SessionPayload } from "@/lib/session";

/**
 * Append-only audit trail. Every meaningful mutation should be logged.
 */
export async function audit(
  session: SessionPayload | null,
  action: string,
  entity?: string,
  entityId?: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: session?.userId ?? null,
        actorEmail: session?.email ?? "system",
        action,
        entity: entity ?? null,
        entityId: entityId ?? null,
        meta: meta as object,
      },
    });
  } catch (e) {
    // Never let audit failures break the main operation, but surface in logs.
    console.error("Audit log failed", e);
  }
}
