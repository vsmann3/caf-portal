import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole, jsonError, ApiError } from "@/lib/guard";
import { applicationScope, filingFranchise } from "@/lib/caf-access";
import { demoEnabled, requireDemo, uuid } from "@/lib/radius-demo/common";
import {
  catalog,
  reserve,
  reserveInput,
  renew,
} from "@/lib/radius-demo/intents";

type Context = { params: Promise<{ operation: string }> };
export async function GET(request: NextRequest, context: Context) {
  return handle(request, context);
}
export async function POST(request: NextRequest, context: Context) {
  return handle(request, context);
}
async function handle(request: NextRequest, { params }: Context) {
  const auth = await requireRole([
    "SUPER_ADMIN",
    "COMPANY_ADMIN",
    "FRANCHISE_USER",
  ]);
  if (auth instanceof NextResponse) return auth;
  const { operation } = await params;
  const reply = (value: unknown) =>
    NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
  try {
    if (operation === "config" && request.method === "GET") {
      const franchise = await filingFranchise(
        auth,
        request.nextUrl.searchParams.get("franchiseId") ?? "",
      );
      const b =
        franchise && demoEnabled()
          ? await prisma.radiusDemoBinding.findUnique({
              where: { companyId: franchise.companyId },
            })
          : null;
      return reply({
        enabled: Boolean(b?.active),
        mode: "ISOLATED_STAGE_ONLY",
      });
    }
    requireDemo();
    if (operation === "plans" && request.method === "GET") {
      const cursor = request.nextUrl.searchParams.get("cursor");
      if (cursor && cursor.length > 2048)
        return jsonError(400, "Invalid cursor");
      return reply(
        await catalog(
          auth,
          request.nextUrl.searchParams.get("franchiseId") ?? "",
          cursor ?? undefined,
        ),
      );
    }
    if (operation === "intents" && request.method === "POST") {
      const parsed = reserveInput.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success)
        return jsonError(400, "Invalid demo reservation fields");
      return reply(await reserve(auth, parsed.data));
    }
    if (operation === "renew" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!uuid.safeParse(body?.intentId).success)
        return jsonError(400, "Service request ID required");
      return reply(await renew(auth, body.intentId));
    }
    if (operation === "status" && request.method === "GET") {
      const app = await prisma.customerApplication.findFirst({
        where: {
          id: request.nextUrl.searchParams.get("applicationId") ?? "",
          ...applicationScope(auth),
        },
      });
      if (!app) return jsonError(404, "CAF not found");
      const intent = await prisma.radiusDemoIntent.findUnique({
        where: { applicationId: app.id },
      });
      if (!intent) return reply({ enabled: false });
      const job = await prisma.radiusDemoDelivery.findFirst({
        where: { intentId: intent.id },
        orderBy: { createdAt: "desc" },
      });
      return reply({
        enabled: true,
        mode: "ISOLATED_STAGE_ONLY",
        customerId: intent.customerId,
        username: intent.username,
        planId: intent.planId,
        serviceRequestId: intent.id,
        deliveryId: job?.id ?? null,
        state: job?.state ?? intent.state,
        credentialAccepted: job?.credentialAccepted ?? false,
        receiptVersion: job?.receiptVersion ?? 0,
        serviceId: job?.serviceId ?? null,
        errorCode: job?.errorCode ?? null,
        activationRequested: false,
        networkActive: job?.receipt
          ? (job.receipt as Record<string, unknown>).service_status === "active"
          : null,
        attempts: job?.attempts ?? 0,
      });
    }
    if (operation === "retry" && request.method === "POST") {
      if (auth.role === "FRANCHISE_USER")
        return jsonError(403, "Company reviewer required");
      const body = await request.json().catch(() => null);
      if (!uuid.safeParse(body?.deliveryId).success)
        return jsonError(400, "Delivery ID required");
      const job = await prisma.radiusDemoDelivery.findUnique({
        where: { id: body.deliveryId },
      });
      const app = job
        ? await prisma.customerApplication.findFirst({
            where: { id: job.applicationId, ...applicationScope(auth) },
          })
        : null;
      if (!app || !job) return jsonError(404, "Delivery not found");
      if (!["PENDING", "RECONCILING", "WAITING"].includes(job.state))
        return jsonError(
          409,
          "Delivery needs explicit recovery or is already staged; no password reset is permitted",
        );
      await prisma.radiusDemoDelivery.update({
        where: { id: job.id },
        data: { nextAttemptAt: new Date() },
      });
      return reply({ queued: true });
    }
    return jsonError(404, "Demo operation not found");
  } catch (error) {
    if (error instanceof ApiError)
      return jsonError(error.status, error.message);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    )
      return jsonError(
        409,
        "Concurrent reservation already exists. Reload and retry the same selection.",
      );
    return jsonError(
      503,
      "Isolated demo operation could not be confirmed. Reload before retrying.",
    );
  }
}
