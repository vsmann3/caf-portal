import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { jsonError } from "@/lib/guard";
import { getProviderFor } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

/**
 * Serve a stored document. Access rules mirror application access:
 * - SUPER_ADMIN: any document
 * - COMPANY_ADMIN: documents of own company
 * - FRANCHISE_USER: documents of own franchise
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return jsonError(401, "Not authenticated");
  const { id } = await params;

  const doc = await prisma.document.findUnique({
    where: { id },
    include: { application: { select: { id: true, companyId: true, franchiseId: true } } },
  });
  if (!doc) return jsonError(404, "Document not found");

  if (session.role === "COMPANY_ADMIN" && doc.application.companyId !== session.companyId) {
    return jsonError(403, "Forbidden");
  }
  if (session.role === "FRANCHISE_USER") {
    if (
      doc.application.companyId !== session.companyId ||
      doc.application.franchiseId !== session.franchiseId
    ) {
      return jsonError(403, "Forbidden");
    }
  }

  try {
    const provider = await getProviderFor(doc.storageProvider);
    const { buffer } = await provider.read(doc.storageKey);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Length": String(buffer.byteLength),
        // Force download with original (sanitized) filename.
        "Content-Disposition": `inline; filename="${doc.originalName.replace(/[^\w.\- ]/g, "_")}"`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("Document read failed", e);
    return jsonError(500, "Failed to read document from storage");
  }
}
