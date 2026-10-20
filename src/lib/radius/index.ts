import "server-only";
import { prisma } from "@/lib/db";
import type { RadiusConfig, RadiusAdapter, RadiusSubscriberPayload } from "./types";
import { NoopRadiusAdapter } from "./types";

const RADIUS_SETTING_KEY = "radius.config";

export function defaultRadiusConfig(): RadiusConfig {
  return { enabled: false, provider: "custom" };
}

export async function getRadiusConfig(): Promise<RadiusConfig> {
  const row = await prisma.systemSetting.findUnique({ where: { key: RADIUS_SETTING_KEY } });
  if (!row) return defaultRadiusConfig();
  return row.value as RadiusConfig;
}

export function getRadiusAdapter(_config: RadiusConfig): RadiusAdapter {
  // Real adapters for IconWave/JazzNetwork will be implemented once API specs are provided.
  // For now, we keep the interface pluggable.
  return new NoopRadiusAdapter();
}

export function buildRadiusPayload(app: any, franchise?: any): RadiusSubscriberPayload {
  const install = [app.addressLine1, app.addressLine2].filter(Boolean).join(", ");
  const billing = [
    app.billingAddressLine1 ?? app.addressLine1,
    app.billingAddressLine2 ?? app.addressLine2,
    app.billingCity ?? app.city,
    app.billingState ?? app.state,
    app.billingPincode ?? app.pincode,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    cafNumber: app.cafNumber,
    companyCode: app.company?.companyCode ?? "",
    franchiseCode: franchise?.code,
    customerName: app.customerName,
    mobile: app.mobile,
    email: app.email,
    installationAddress: install,
    billingAddress: billing,
    city: app.city,
    state: app.state,
    pincode: app.pincode,
    planName: app.planName,
    bandwidth: app.bandwidth,
    radiusUsername: app.radiusUsername ?? app.broadbandUsername ?? null,
    connectionType: app.connectionType,
    customerType: app.customerType,
    idProofType: app.idProofType,
    idNumber: app.idNumber,
    serviceId: app.serviceId,
  };
}
