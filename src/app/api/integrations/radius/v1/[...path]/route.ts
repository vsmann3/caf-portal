import { NextResponse, type NextRequest } from "next/server";
import { randomUUID, createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { demoEnabled, digest } from "@/lib/radius-demo/common";
import type { RadiusDemoBinding } from "@prisma/client";

class ReadError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
const fail = (code: string, status: number) => {
  throw new ReadError(code, status);
};
function cursorMac(value: string) {
  return createHmac("sha256", process.env.AUTH_SECRET!)
    .update("radius-demo-read-v1\0" + value)
    .digest("base64url");
}
function signCursor(after: string, scope: string) {
  const value = Buffer.from(
    JSON.stringify({ after, scope, expires: Date.now() + 900000 }),
  ).toString("base64url");
  return value + "." + cursorMac(value);
}
function readCursor(value: string | null, scope: string) {
  if (!value) return undefined;
  if (value.length > 2048) return fail("invalid_cursor", 400);
  const [data, mac, extra] = value.split(".");
  const expected = cursorMac(data ?? "");
  if (
    extra ||
    !mac ||
    mac.length !== expected.length ||
    !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
  )
    return fail("invalid_cursor", 400);
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return fail("invalid_cursor", 400);
  }
  if (
    parsed.scope !== scope ||
    typeof parsed.after !== "string" ||
    !Number.isFinite(parsed.expires)
  )
    return fail("invalid_cursor", 400);
  if (parsed.expires <= Date.now()) return fail("cursor_expired", 410);
  return parsed.after as string;
}
async function authenticate(request: NextRequest): Promise<RadiusDemoBinding> {
  if (!demoEnabled()) return fail("not_found", 404);
  const match = /^Bearer ([A-Za-z0-9_.-]{32,256})$/.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match) return fail("invalid_token", 401);
  const b = await prisma.radiusDemoBinding.findUnique({
    where: { inboundTokenDigest: digest(match[1]) },
  });
  if (!b?.active || b.inboundExpiresAt.getTime() <= Date.now())
    return fail("invalid_token", 401);
  const c = await prisma.company.findUnique({ where: { id: b.companyId } });
  if (!c?.isActive) return fail("invalid_token", 401);
  return b;
}
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  try {
    const b = await authenticate(request),
      path = (await params).path;
    const url = request.nextUrl;
    for (const [k] of url.searchParams)
      if (
        !["cursor", "limit"].includes(k) ||
        url.searchParams.getAll(k).length !== 1
      )
        fail("invalid_query", 400);
    const raw = url.searchParams.get("limit") ?? "100";
    if (!/^[1-9][0-9]{0,2}$/.test(raw) || Number(raw) > 100)
      fail("invalid_limit", 400);
    const limit = Number(raw),
      scope = b.inboundTokenDigest + "/" + path.join("/");
    const after = readCursor(url.searchParams.get("cursor"), scope);
    const page = <T extends { id: string }>(
      rows: T[],
      project: (row: T) => unknown,
    ) => ({
      items: rows.slice(0, limit).map(project),
      has_more: rows.length > limit,
      next_cursor:
        rows.length > limit ? signCursor(rows[limit - 1].id, scope) : null,
    });
    if (path.length === 1 && path[0] === "companies") {
      const rows = await prisma.company.findMany({
        where: {
          id: b.companyId,
          ...(after ? { id: { equals: b.companyId, gt: after } } : {}),
        },
        take: limit + 1,
        orderBy: { id: "asc" },
      });
      return reply(
        page(rows, (c) => ({
          id: c.id,
          code: c.companyCode,
          name: c.name,
          is_active: c.isActive,
        })),
      );
    }
    if (
      path.length === 3 &&
      path[0] === "companies" &&
      path[1] === b.companyId &&
      path[2] === "franchises"
    ) {
      const rows = await prisma.franchise.findMany({
        where: {
          companyId: b.companyId,
          id: {
            in: Object.keys(b.franchiseMappings as object),
            ...(after ? { gt: after } : {}),
          },
        },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
      return reply(
        page(rows, (f) => ({
          id: f.id,
          company_id: f.companyId,
          code: f.code,
          name: f.name,
          is_active: f.isActive,
        })),
      );
    }
    if (path[0] !== "customers" || !/^[1-9][0-9]{9}$/.test(path[1] ?? ""))
      return fail("not_found", 404);
    const master = await prisma.customerNumber.findFirst({
      where: { id: path[1], companyId: b.companyId },
    });
    if (
      !master ||
      !master.franchiseId ||
      !(master.franchiseId in (b.franchiseMappings as object))
    )
      return fail("not_found", 404);
    const company_ref = { id: b.companyId },
      franchise_ref = { id: master.franchiseId };
    if (path.length === 2) {
      const pending =
        master.profileVersion === 0
          ? await prisma.customerApplication.findFirst({
              where: {
                customerId: master.id,
                companyId: b.companyId,
                status: { in: ["SUBMITTED", "UNDER_REVIEW"] },
              },
              orderBy: { createdAt: "desc" },
            })
          : null;
      return reply({
        schema_version: "1.0",
        customer_id: master.id,
        customer_version: master.profileVersion,
        company_ref,
        franchise_ref,
        identity_review: pending
          ? {
              review_id: `${pending.id}:${pending.revision}`,
              status: "PENDING_REVIEW",
              base_profile_version: 0,
              draft_id: null,
              revision_id: `${pending.id}:${pending.revision}`,
            }
          : null,
        approved_profile:
          master.profileVersion &&
          master.approvedProfile &&
          master.profileApprovedAt
            ? {
                profile_id: `${master.id}:${master.profileVersion}`,
                customer_id: master.id,
                company_ref,
                franchise_ref,
                profile_version: master.profileVersion,
                approved_at: master.profileApprovedAt.toISOString(),
                profile: master.approvedProfile,
              }
            : null,
      });
    }
    if (path[2] !== "applications") return fail("not_found", 404);
    if (path.length === 3) {
      const rows = await prisma.customerApplication.findMany({
        where: {
          customerId: master.id,
          companyId: b.companyId,
          franchiseId: { in: Object.keys(b.franchiseMappings as object) },
          ...(after ? { id: { gt: after } } : {}),
        },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
      const items = await Promise.all(
        rows.slice(0, limit).map(async (a) => {
          const delivery = await prisma.radiusDemoDelivery.findFirst({
            where: { applicationId: a.id },
            orderBy: { createdAt: "desc" },
          });
          return {
            application_id: a.id,
            caf_number: a.cafNumber,
            revision: a.revision,
            service_request_id: a.serviceRequestId,
            review_status: a.status,
            latest_approval: delivery
              ? {
                  approval_id: delivery.eventId,
                  revision: delivery.revision,
                  approval_version: delivery.approvalVersion,
                  approval_status: "APPROVED",
                }
              : null,
          };
        }),
      );
      return reply({ ...page(rows, (r) => r), items });
    }
    if (
      path.length !== 6 ||
      path[4] !== "approvals" ||
      !/^[1-9][0-9]*$/.test(path[5])
    )
      return fail("not_found", 404);
    const app = await prisma.customerApplication.findFirst({
      where: {
        id: path[3],
        customerId: master.id,
        companyId: b.companyId,
        franchiseId: { in: Object.keys(b.franchiseMappings as object) },
      },
    });
    if (!app) return fail("not_found", 404);
    const job = await prisma.radiusDemoDelivery.findUnique({
      where: {
        applicationId_revision: {
          applicationId: app.id,
          revision: Number(path[5]),
        },
      },
      include: { intent: true },
    });
    if (
      !job ||
      job.intent.customerId !== master.id ||
      job.intent.companyId !== b.companyId ||
      job.intent.id !== app.serviceRequestId
    )
      return fail("not_found", 404);
    return reply({
      schema_version: "1.0",
      customer_id: master.id,
      customer_version: master.profileVersion,
      company_ref,
      franchise_ref: { id: app.franchiseId },
      application_id: app.id,
      revision: job.revision,
      service_request_id: job.intentId,
      approval_id: job.eventId,
      approval_status:
        app.status === "APPROVED" && app.revision === job.revision
          ? "APPROVED"
          : "SUPERSEDED",
      approval_version: job.approvalVersion,
      service_approval_version: job.intent.approvalVersion,
      updated_at: job.createdAt.toISOString(),
      approval_event: job.approvalEvent,
    });
  } catch (e) {
    const code = e instanceof ReadError ? e.code : "temporarily_unavailable";
    return reply(
      {
        error: {
          code,
          message:
            code === "temporarily_unavailable"
              ? "Service unavailable"
              : "Request is unavailable in this scope",
          retryable: code === "temporarily_unavailable",
        },
        request_id: randomUUID(),
      },
      e instanceof ReadError ? e.status : 503,
    );
  }
}
