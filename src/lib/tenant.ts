import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export interface TenantContext {
  companyId: string | null;
  company?: {
    id: string;
    name: string;
    companyCode: string;
    domain: string | null;
    logoUrl: string | null;
    faviconUrl: string | null;
    primaryColor: string | null;
    secondaryColor: string | null;
    accentColor: string | null;
    loginSubtitle: string | null;
    supportEmail: string | null;
    supportPhone: string | null;
    customCss: string | null;
    isActive: boolean;
  } | null;
}

/**
 * Resolve tenant by incoming request hostname. Supports:
 * - Custom company domain: my.infolinkbroadband.com -> company.domain
 * - (Future) subdomain: infolink.caf.example.com -> can map by companyCode/prefix
 * Falls back to null (global app).
 */
export async function resolveTenant(request: NextRequest): Promise<TenantContext> {
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  if (!host) return { companyId: null };

  const company = await prisma.company.findFirst({
    where: {
      domain: host,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      companyCode: true,
      domain: true,
      logoUrl: true,
      faviconUrl: true,
      primaryColor: true,
      secondaryColor: true,
      accentColor: true,
      loginSubtitle: true,
      supportEmail: true,
      supportPhone: true,
      customCss: true,
      isActive: true,
    },
  });
  if (!company) return { companyId: null };
  return { companyId: company.id, company };
}
