import "server-only";

export interface RadiusConfig {
  enabled: boolean;
  provider: "iconwave" | "jazznetwork" | "custom";
  baseUrl?: string;
  authHeader?: string;
  usernameField?: string;
  timeoutMs?: number;
}

export interface RadiusSettingsView extends RadiusConfig {
  apiKeyConfigured: boolean;
  runtimeStatus: "NOT_IMPLEMENTED";
}

// Local diagnostic only. This is NOT the shared approval-event wire schema.
export interface RadiusApprovalReference {
  format: "caf-radius-local-reference-v1";
  customer_id: string;
  company_id: string;
  franchise_id: string;
  caf: {
    application_id: string;
    number: string;
    revision: number;
    status: "APPROVED";
  };
}

export type RadiusBlockedResult = {
  ok: false;
  code: "RADIUS_DISABLED" | "RADIUS_NOT_IMPLEMENTED";
  error: string;
};

// No transport exists yet. A settings toggle must never imply provisioning.
export function radiusBlockedResult(enabled: boolean): RadiusBlockedResult {
  return enabled
    ? {
        ok: false,
        code: "RADIUS_NOT_IMPLEMENTED",
        error:
          "RADIUS delivery is not implemented; no provisioning was attempted.",
      }
    : {
        ok: false,
        code: "RADIUS_DISABLED",
        error: "RADIUS delivery is disabled; no provisioning was attempted.",
      };
}
