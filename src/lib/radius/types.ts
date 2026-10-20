import "server-only";

export interface RadiusConfig {
  enabled: boolean;
  provider: "iconwave" | "jazznetwork" | "custom";
  baseUrl?: string;
  apiKey?: string;
  authHeader?: string;
  usernameField?: string;
  timeoutMs?: number;
}

export interface RadiusSubscriberPayload {
  cafNumber: string;
  companyCode: string;
  franchiseCode?: string;
  customerName: string;
  mobile: string;
  email?: string | null;
  installationAddress: string;
  billingAddress?: string;
  city: string;
  state: string;
  pincode: string;
  planName?: string | null;
  bandwidth?: string | null;
  radiusUsername?: string | null;
  connectionType: string;
  customerType: string;
  idProofType: string;
  idNumber: string;
  serviceId?: string | null;
}

export interface RadiusAdapter {
  name: string;
  createOrActivate(payload: RadiusSubscriberPayload): Promise<{ ok: boolean; remoteId?: string; raw?: unknown; error?: string }>;
}

export class NoopRadiusAdapter implements RadiusAdapter {
  name = "noop";
  async createOrActivate() {
    return { ok: true, remoteId: "SKIPPED" };
  }
}
