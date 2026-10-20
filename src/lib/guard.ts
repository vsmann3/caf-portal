import "server-only";
import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { getSession, type SessionPayload } from "@/lib/session";

/**
 * Central authorization guard for API route handlers.
 *
 * Usage:
 *   const auth = await requireRole(["COMPANY_ADMIN", "SUPER_ADMIN"]);
 *   if (auth instanceof NextResponse) return auth; // 401/403 response
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function requireRole(
  roles: Role[],
): Promise<SessionPayload | NextResponse> {
  const session = await getSession();
  if (!session) return jsonError(401, "Not authenticated");
  if (!roles.includes(session.role)) {
    return jsonError(403, "You do not have permission to perform this action");
  }
  return session;
}

/**
 * Scope for listing/creating applications & franchises.
 * - SUPER_ADMIN: can access any company (companyId passed explicitly, or all)
 * - COMPANY_ADMIN: locked to own company
 * - FRANCHISE_USER: locked to own franchise
 */
export type DataScope =
  | { kind: "all" }
  | { kind: "company"; companyId: string }
  | { kind: "franchise"; companyId: string; franchiseId: string };

export function scopeOf(session: SessionPayload): DataScope {
  if (session.role === "SUPER_ADMIN") return { kind: "all" };
  if (session.role === "COMPANY_ADMIN" && session.companyId) {
    return { kind: "company", companyId: session.companyId };
  }
  if (session.role === "FRANCHISE_USER" && session.companyId && session.franchiseId) {
    return {
      kind: "franchise",
      companyId: session.companyId,
      franchiseId: session.franchiseId,
    };
  }
  // Defensive: a session without tenancy binding may only see nothing.
  return { kind: "franchise", companyId: "", franchiseId: "" };
}
