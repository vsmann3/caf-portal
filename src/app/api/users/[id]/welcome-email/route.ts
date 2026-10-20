import { NextResponse, type NextRequest } from "next/server";
import { requireRole, jsonError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { sendWelcomeEmail } from "@/lib/email";
import { audit } from "@/lib/audit";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(["SUPER_ADMIN", "COMPANY_ADMIN"]);
  if (auth instanceof NextResponse) return auth;
  if (auth.role === "COMPANY_ADMIN" && !auth.companyId) return jsonError(403, "Company scope is required");
  const { id } = await params;
  const user = await prisma.user.findFirst({ where: { id, isActive: true,
    ...(auth.role === "COMPANY_ADMIN" ? { companyId: auth.companyId!, role: "FRANCHISE_USER" } : {}) },
    select: { id: true, name: true, email: true, role: true, company: { select: { name: true } } } });
  if (!user) return jsonError(404, "Active user not found");
  const email = await sendWelcomeEmail(user);
  await audit(auth, "user.welcome-email", "User", user.id, { status: email.status });
  return NextResponse.json({ email }, { status: email.status === "sent" ? 200 : email.status === "disabled" ? 409 : 502 });
}
