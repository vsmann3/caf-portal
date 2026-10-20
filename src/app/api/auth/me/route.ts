import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null });

  const [company, franchise] = await Promise.all([
    session.companyId
      ? prisma.company.findUnique({
          where: { id: session.companyId },
          select: { id: true, name: true, companyCode: true },
        })
      : Promise.resolve(null),
    session.franchiseId
      ? prisma.franchise.findUnique({
          where: { id: session.franchiseId },
          select: { id: true, name: true, code: true },
        })
      : Promise.resolve(null),
  ]);

  return NextResponse.json({ user: session, company, franchise });
}
