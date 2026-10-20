import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole, jsonError, scopeOf } from "@/lib/guard";
import { createApplicationSchema } from "@/lib/validators";
import { cafNumber } from "@/lib/codes";
import { audit } from "@/lib/audit";
import { getActiveProvider } from "@/lib/storage";
import { randomBytes } from "crypto";
import type { DocumentType } from "@prisma/client";

const MAX_FILES = 10;
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB per file
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const DOCUMENT_TYPES: DocumentType[] = [
  "PASSPORT_PHOTO",
  "ID_PROOF",
  "ADDRESS_PROOF",
  "SIGNED_CAF",
  "BANK_PROOF",
  "BUSINESS_PROOF",
  "OTHER",
];

/** List applications (CAF records) visible to the caller. */
export async function GET(request: NextRequest) {
  const auth = await requireRole(["SUPER_ADMIN", "COMPANY_ADMIN", "FRANCHISE_USER"]);
  if (auth instanceof NextResponse) return auth;

  const scope = scopeOf(auth);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const q = url.searchParams.get("q")?.trim();
  const franchiseIdParam = url.searchParams.get("franchiseId") ?? undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? "20") || 20));

  const where: Record<string, unknown> = {};
  if (scope.kind === "company") where.companyId = scope.companyId;
  if (scope.kind === "franchise") {
    where.companyId = scope.companyId;
    where.franchiseId = scope.franchiseId;
  }
  // Company admin / super admin may additionally filter by franchise.
  if (
    franchiseIdParam &&
    (scope.kind === "company" || scope.kind === "all")
  ) {
    where.franchiseId = franchiseIdParam;
  }
  if (status) where.status = status;
  if (q) {
    where.OR = [
      { customerName: { contains: q, mode: "insensitive" } },
      { mobile: { contains: q } },
      { cafNumber: { contains: q, mode: "insensitive" } },
      { idNumber: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.customerApplication.count({ where }),
    prisma.customerApplication.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        franchise: { select: { id: true, name: true, code: true } },
        company: { select: { id: true, name: true, companyCode: true } },
        submittedBy: { select: { id: true, name: true } },
        _count: { select: { documents: true } },
      },
    }),
  ]);

  return NextResponse.json({ items, total, page, pageSize });
}

/**
 * Submit a new CAF. Accepts multipart/form-data: JSON fields under "data",
 * uploaded files under "files" (each with matching "docType" fields).
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(["SUPER_ADMIN", "COMPANY_ADMIN", "FRANCHISE_USER"]);
  if (auth instanceof NextResponse) return auth;

  const form = await request.formData().catch(() => null);
  if (!form) return jsonError(400, "Expected multipart form data");

  const rawData = form.get("data");
  let json: unknown;
  try {
    json = JSON.parse(typeof rawData === "string" ? rawData : "{}");
  } catch {
    return jsonError(400, "Invalid form payload");
  }

  const parsed = createApplicationSchema.safeParse(json);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const data = parsed.data;

  // ---- Tenancy: who may file for which franchise ----
  const scope = scopeOf(auth);
  let companyId: string;
  if (scope.kind === "all") {
    // Super admin: franchise determines the company.
    const franchise = await prisma.franchise.findUnique({
      where: { id: data.franchiseId },
    });
    if (!franchise) return jsonError(404, "Franchise not found");
    companyId = franchise.companyId;
  } else if (scope.kind === "company") {
    const franchise = await prisma.franchise.findFirst({
      where: { id: data.franchiseId, companyId: scope.companyId },
    });
    if (!franchise) return jsonError(404, "Franchise not found in your company");
    companyId = scope.companyId;
  } else {
    // Franchise users: own franchise ONLY.
    if (data.franchiseId !== scope.franchiseId) {
      return jsonError(403, "You can only file CAFs for your own franchise");
    }
    companyId = scope.companyId;
  }

  // ---- Collect files ----
  const files = form
    .getAll("files")
    .filter((f): f is File => typeof f !== "string" && f instanceof File && f.size > 0);
  const docTypes = form.getAll("docType").map(String);

  if (files.length > MAX_FILES) return jsonError(400, `Maximum ${MAX_FILES} files allowed`);

  for (const file of files) {
    if (!ALLOWED_TYPES[file.type]) {
      return jsonError(400, `Unsupported file type: ${file.type || "unknown"} (${file.name})`);
    }
    if (file.size > MAX_FILE_BYTES) {
      return jsonError(400, `File too large (max 8 MB): ${file.name}`);
    }
  }

  // ---- Persist (application + docs) ----
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return jsonError(404, "Company not found");

  const provider = await getActiveProvider();

  // Atomic per-company CAF sequence.
  const counter = await prisma.counter.upsert({
    where: { key: `caf-seq:${companyId}` },
    update: { value: { increment: 1 } },
    create: { key: `caf-seq:${companyId}`, value: 1 },
  });
  const number = cafNumber(company.companyCode, counter.value);

  const application = await prisma.customerApplication.create({
    data: {
      cafNumber: number,
      companyId,
      franchiseId: data.franchiseId,
      customerName: data.customerName,
      gender: data.gender ?? null,
      dob: data.dob ?? null,
      fatherName: data.fatherName || null,
      mobile: data.mobile,
      email: data.email || null,
      altPhone: data.altPhone || null,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2 || null,
      city: data.city,
      state: data.state,
      pincode: data.pincode,
      idProofType: data.idProofType,
      idNumber: data.idNumber,
      connectionType: data.connectionType,
      customerType: data.customerType ?? "RESIDENTIAL",
      planName: data.planName || null,
      bandwidth: data.bandwidth || null,
      connectionAddress: data.connectionAddress || null,
      broadbandUsername: data.broadbandUsername || null,
      remarks: data.remarks || null,
      submittedById: auth.userId,
    },
  });

  // Upload documents, recording the provider snapshot per file.
  const now = new Date();
  const savedKeys: string[] = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = ALLOWED_TYPES[file.type];
      const docType = (DOCUMENT_TYPES.includes(docTypes[i] as DocumentType)
        ? docTypes[i]
        : "OTHER") as DocumentType;
      const key = `${company.companyCode}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${application.id}-${randomBytes(6).toString("hex")}.${ext}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      await provider.save(key, buffer, file.type);
      savedKeys.push(key);
      await prisma.document.create({
        data: {
          applicationId: application.id,
          documentType: docType,
          originalName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          storageProvider: provider.name,
          storageKey: key,
        },
      });
    }
  } catch (e) {
    // Best-effort cleanup of already-written blobs.
    for (const key of savedKeys) {
      await provider.remove(key).catch(() => undefined);
    }
    await prisma.customerApplication.delete({ where: { id: application.id } }).catch(() => undefined);
    console.error("CAF document upload failed", e);
    return jsonError(500, "Failed to store documents. The application was not saved.");
  }

  await audit(auth, "caf.submit", "CustomerApplication", application.id, {
    cafNumber: number,
    franchiseId: data.franchiseId,
    documents: files.length,
  });

  return NextResponse.json({ application }, { status: 201 });
}
