import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { Prisma, type DocumentType } from "@prisma/client";
import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/db";
import { requireRole, jsonError, ApiError } from "@/lib/guard";
import { createApplicationSchema } from "@/lib/validators";
import {
  filingFranchise,
  applicationScope,
  availableUsername,
} from "@/lib/caf-access";
import {
  DOCUMENT_OPTIONS,
  MAX_DOCUMENT_BYTES,
  usernameCandidates,
} from "@/lib/caf-fields";
import { getActiveProvider } from "@/lib/storage";
import { cafNumber } from "@/lib/codes";
import { audit } from "@/lib/audit";

const types: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
function validContent(buffer: Buffer, mime: string) {
  if (mime === "application/pdf")
    return buffer.subarray(0, 5).toString() === "%PDF-";
  if (mime === "image/png")
    return buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg")
    return buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  return (
    buffer.subarray(0, 4).toString() === "RIFF" &&
    buffer.subarray(8, 12).toString() === "WEBP"
  );
}

export async function saveApplication(request: NextRequest) {
  const auth = await requireRole([
    "SUPER_ADMIN",
    "COMPANY_ADMIN",
    "FRANCHISE_USER",
  ]);
  if (auth instanceof NextResponse) return auth;
  if (Number(request.headers.get("content-length")) > 42 * 1024 * 1024)
    return jsonError(413, "Upload request too large");
  let exceeded = false;
  let total = 0;
  const stream = request.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > 42 * 1024 * 1024) {
          exceeded = true;
          throw new Error("Upload request too large");
        }
        controller.enqueue(chunk);
      },
    }),
  );
  const form = stream
    ? await new Response(stream, {
        headers: { "Content-Type": request.headers.get("content-type") ?? "" },
      })
        .formData()
        .catch(() => null)
    : null;
  if (exceeded) return jsonError(413, "Upload request too large");
  if (!form) return jsonError(400, "Expected multipart form data");
  let body;
  try {
    body = JSON.parse(String(form.get("data") ?? "{}"));
  } catch {
    return jsonError(400, "Invalid form payload");
  }
  const parsed = createApplicationSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message,
        fields: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  const data = parsed.data;
  const franchise = await filingFranchise(auth, data.franchiseId);
  if (!franchise) return jsonError(404, "Franchise not found");
  const previous = data.applicationId
    ? await prisma.customerApplication.findFirst({
        where: { id: data.applicationId, ...applicationScope(auth) },
        include: { documents: true },
      })
    : null;
  if (data.applicationId && !previous)
    return jsonError(404, "Application not found");
  if (
    previous &&
    (previous.status !== "REJECTED" ||
      previous.revision !== data.revision ||
      previous.franchiseId !== franchise.id)
  )
    return jsonError(
      409,
      "Only the current rejected revision can be corrected in its original franchise",
    );
  const entries = form.getAll("files");
  const docTypes = form.getAll("docType").map(String);
  if (entries.length !== docTypes.length || entries.length > 10)
    return jsonError(400, "Maximum 10 files with matching document categories");
  const uploads: { file: File; buffer: Buffer; category: DocumentType }[] = [];
  for (let i = 0; i < entries.length; i++) {
    const file = entries[i];
    if (typeof file === "string" || !file.size || !types[file.type])
      return jsonError(400, "Use non-empty JPG, PNG, WEBP or PDF files");
    if (file.size > MAX_DOCUMENT_BYTES)
      return jsonError(400, `File too large (max 4 MB): ${file.name}`);
    if (!DOCUMENT_OPTIONS.some(([value]) => value === docTypes[i]))
      return jsonError(400, "Unknown document category");
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!validContent(buffer, file.type))
      return jsonError(
        400,
        `File contents do not match its type: ${file.name}`,
      );
    uploads.push({ file, buffer, category: docTypes[i] as DocumentType });
  }
  // New uploads replace the same category for corrections; old originals stay stored.
  const replaced = new Set(uploads.map((u) => u.category));
  const retained =
    previous?.documents.filter((d) => !replaced.has(d.documentType)) ?? [];
  const categories = new Set([
    ...retained.map((d) => d.documentType),
    ...uploads.map((u) => u.category),
  ]);
  const required: DocumentType[] = [
    "PASSPORT_PHOTO",
    "ID_PROOF",
    "ADDRESS_PROOF",
  ];
  if (data.customerType === "COMMERCIAL") required.push("GST_CERTIFICATE");
  const missing = required.filter((t) => !categories.has(t));
  if (missing.length)
    return jsonError(
      400,
      `Required documents: ${missing.map((t) => t.replaceAll("_", " ")).join(", ")}`,
    );
  if (retained.length + uploads.length > 10)
    return jsonError(400, "Maximum 10 documents per CAF");
  const provider = await getActiveProvider();
  const saved: {
    key: string;
    file: File;
    category: DocumentType;
    sha256: string;
  }[] = [];
  try {
    for (const upload of uploads) {
      const key = `${franchise.company.companyCode}/${new Date().getFullYear()}/${randomBytes(16).toString("hex")}.${types[upload.file.type]}`;
      // Register before save so a partial write is also eligible for cleanup.
      saved.push({
        key,
        file: upload.file,
        category: upload.category,
        sha256: createHash("sha256").update(upload.buffer).digest("hex"),
      });
      await provider.save(key, upload.buffer, upload.file.type);
    }
    const application = await prisma.$transaction(
      async (tx) => {
        // This counter row serialises username allocation across the company's franchises.
        const sequence = await tx.counter.upsert({
          where: { key: `caf-seq:${franchise.companyId}` },
          update: { value: { increment: 1 } },
          create: { key: `caf-seq:${franchise.companyId}`, value: 1 },
        });
        let username = previous?.broadbandUsername || "";
        if (!username) {
          const candidates = usernameCandidates(data.customerName, data.mobile);
          candidates.push(
            `${candidates.at(-1)}${randomBytes(4).toString("hex")}`,
          );
          username =
            (await availableUsername(
              franchise.companyId,
              candidates,
              undefined,
              tx,
            )) ?? "";
        }
        if (!username)
          throw new ApiError(
            409,
            "Could not allocate a username. Please retry.",
          );
        const fields = {
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
          billingAddressLine1: data.billingAddressLine1,
          billingAddressLine2: data.billingAddressLine2 || null,
          billingCity: data.billingCity,
          billingState: data.billingState,
          billingPincode: data.billingPincode,
          businessName:
            data.customerType === "COMMERCIAL" ? data.businessName : null,
          gstNumber: data.customerType === "COMMERCIAL" ? data.gstNumber : null,
          idProofType: data.idProofType,
          idNumber: data.idNumber,
          connectionType: data.connectionType,
          customerType: data.customerType ?? "RESIDENTIAL",
          planName: data.planName || null,
          bandwidth: data.bandwidth || null,
          broadbandUsername: username,
          remarks: data.remarks || null,
          declarationAcceptedAt: new Date(),
        };
        let app;
        if (previous) {
          const result = await tx.customerApplication.updateMany({
            where: {
              id: previous.id,
              status: "REJECTED",
              revision: data.revision,
            },
            data: {
              ...fields,
              status: "SUBMITTED",
              revision: { increment: 1 },
              reviewedById: null,
              reviewedAt: null,
              rejectionReason: null,
            },
          });
          if (!result.count)
            throw new ApiError(
              409,
              "Application changed. Reload before resubmitting.",
            );
          await tx.auditLog.create({
            data: {
              actorId: auth.userId,
              actorEmail: auth.email,
              action: "caf.correction.previous",
              entity: "CustomerApplication",
              entityId: previous.id,
              meta: JSON.parse(JSON.stringify(previous)),
            },
          });
          await tx.document.deleteMany({
            where: {
              applicationId: previous.id,
              documentType: { in: [...replaced] },
            },
          });
          app = await tx.customerApplication.findUniqueOrThrow({
            where: { id: previous.id },
          });
        } else {
          const draft = data.draftId
            ? await tx.cafDraft.findFirst({
                where: {
                  id: data.draftId,
                  ownerId: auth.userId,
                  version: data.draftVersion ?? -1,
                  companyId: franchise.companyId,
                  franchiseId: franchise.id,
                },
              })
            : null;
          if (data.draftId && !draft)
            throw new ApiError(
              409,
              "Draft changed or was already submitted. Reload before submitting.",
            );
          const customerId =
            draft?.customerId ??
            (await tx.customerNumber.create({ data: {} })).id;
          app = await tx.customerApplication.create({
            data: {
              ...fields,
              customerId,
              cafNumber: cafNumber(
                franchise.company.companyCode,
                sequence.value,
              ),
              companyId: franchise.companyId,
              franchiseId: franchise.id,
              submittedById: auth.userId,
            },
          });
        }
        for (const upload of saved)
          await tx.document.create({
            data: {
              applicationId: app.id,
              documentType: upload.category,
              originalName: upload.file.name,
              mimeType: upload.file.type,
              sizeBytes: upload.file.size,
              sha256: upload.sha256,
              storageProvider: provider.name,
              storageKey: upload.key,
            },
          });
        if (data.draftId) {
          const deleted = await tx.cafDraft.deleteMany({
            where: {
              id: data.draftId,
              ownerId: auth.userId,
              version: data.draftVersion ?? -1,
              companyId: franchise.companyId,
              franchiseId: franchise.id,
            },
          });
          if (!deleted.count)
            throw new ApiError(
              409,
              "Draft changed or was already submitted. Reload before submitting.",
            );
        }
        return app;
      },
      { timeout: 15000 },
    );
    await audit(
      auth,
      previous ? "caf.resubmit" : "caf.submit",
      "CustomerApplication",
      application.id,
      { cafNumber: application.cafNumber, revision: application.revision },
    );
    return NextResponse.json({ application }, { status: previous ? 200 : 201 });
  } catch (error) {
    for (const upload of saved)
      await provider.remove(upload.key).catch(() => undefined);
    if (error instanceof ApiError)
      return jsonError(error.status, error.message);
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return jsonError(
        409,
        "Username was claimed concurrently. Please retry submission.",
      );
    console.error("CAF save failed", error);
    return jsonError(
      500,
      "CAF could not be saved. Your entered fields remain available; please retry.",
    );
  }
}
