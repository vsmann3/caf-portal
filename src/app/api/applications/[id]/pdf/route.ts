import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole, jsonError } from "@/lib/guard";
import { applicationScope } from "@/lib/caf-access";
import { getProviderFor } from "@/lib/storage";
import { approvedCafSchema, buildCafPdf, CafPdfError } from "@/lib/caf-pdf";
import { audit } from "@/lib/audit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const active = new Set<string>();
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole([
    "SUPER_ADMIN",
    "COMPANY_ADMIN",
    "FRANCHISE_USER",
  ]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const app = await prisma.customerApplication.findFirst({
    where: { id, ...applicationScope(auth) },
    include: {
      company: true,
      franchise: true,
      documents: { orderBy: [{ uploadedAt: "asc" }, { id: "asc" }] },
      submittedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
    },
  });
  if (!app) return jsonError(404, "Application not found");
  if (app.status !== "APPROVED")
    return jsonError(409, "PDF download is available only after approval");
  if (active.has(auth.userId) || active.size >= 2)
    return jsonError(429, "PDF generation is busy. Please retry shortly.");
  active.add(auth.userId);
  try {
    let snapshot = app.approvedSnapshot;
    if (snapshot === null) {
      const captured = JSON.parse(
        JSON.stringify({
          ...app,
          legacySnapshot: true,
          snapshotCapturedAt: new Date().toISOString(),
        }),
      );
      const changed = await prisma.customerApplication.updateMany({
        where: {
          id,
          status: "APPROVED",
          revision: app.revision,
          approvedSnapshot: { equals: Prisma.DbNull },
        },
        data: { approvedSnapshot: captured },
      });
      snapshot = changed.count
        ? captured
        : (
            await prisma.customerApplication.findUniqueOrThrow({
              where: { id },
            })
          ).approvedSnapshot;
      if (changed.count)
        await audit(auth, "caf.snapshot.legacy", "CustomerApplication", id, {
          customerId: app.customerId,
        });
    }
    const parsed = approvedCafSchema.safeParse(snapshot);
    if (!parsed.success || parsed.data.customerId !== app.customerId)
      return jsonError(
        422,
        "The approved snapshot cannot be exported. Contact the administrator; no current data was substituted.",
      );
    const bytes = await buildCafPdf(
      parsed.data,
      async (doc) =>
        (await (await getProviderFor(doc.storageProvider)).read(doc.storageKey))
          .buffer,
    );
    await audit(auth, "caf.pdf.download", "CustomerApplication", id, {
      customerId: app.customerId,
      revision: app.revision,
      documents: parsed.data.documents.length,
    });
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="CAF-${app.customerId}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof CafPdfError) return jsonError(422, error.message);
    console.error(
      "CAF PDF generation failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return jsonError(
      500,
      "PDF generation failed. Please retry or contact the administrator.",
    );
  } finally {
    active.delete(auth.userId);
  }
}
