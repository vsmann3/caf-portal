import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole, jsonError } from "@/lib/guard";
import { filingFranchise, applicationScope } from "@/lib/caf-access";

const input = z.object({
  id: z.string().optional(),
  version: z.number().int().positive().optional(),
  payload: z
    .record(z.string().max(1000).or(z.boolean()))
    .refine((p) => typeof p.franchiseId === "string", "Franchise required"),
});

export async function GET() {
  const auth = await requireRole([
    "SUPER_ADMIN",
    "COMPANY_ADMIN",
    "FRANCHISE_USER",
  ]);
  if (auth instanceof NextResponse) return auth;
  const drafts = await prisma.cafDraft.findMany({
    where: { ownerId: auth.userId, ...applicationScope(auth) },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ drafts });
}

export async function POST(request: NextRequest) {
  const auth = await requireRole([
    "SUPER_ADMIN",
    "COMPANY_ADMIN",
    "FRANCHISE_USER",
  ]);
  if (auth instanceof NextResponse) return auth;
  if (Number(request.headers.get("content-length")) > 40000)
    return jsonError(413, "Draft too large");
  const raw = await request.text();
  if (raw.length > 40000) return jsonError(413, "Draft too large");
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError(400, "Invalid draft");
  }
  const parsed = input.safeParse(body);
  if (!parsed.success) return jsonError(400, "Invalid draft fields");
  const { id, version, payload } = parsed.data;
  const franchise = await filingFranchise(auth, String(payload.franchiseId));
  if (!franchise) return jsonError(404, "Franchise not found");
  if (id) {
    const result = await prisma.cafDraft.updateMany({
      where: {
        id,
        ownerId: auth.userId,
        version: version ?? -1,
        ...applicationScope(auth),
      },
      data: {
        payload,
        companyId: franchise.companyId,
        franchiseId: franchise.id,
        version: { increment: 1 },
      },
    });
    if (!result.count)
      return jsonError(
        409,
        "Draft changed or is unavailable. Reload before saving.",
      );
    return NextResponse.json({
      draft: await prisma.cafDraft.findUnique({ where: { id } }),
    });
  }
  const draft = await prisma.cafDraft.create({
    data: {
      ownerId: auth.userId,
      companyId: franchise.companyId,
      franchiseId: franchise.id,
      payload,
      customerNumber: { create: {} },
    },
  });
  return NextResponse.json({ draft }, { status: 201 });
}
