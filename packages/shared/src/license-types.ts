/**
 * Client-safe structural license contracts.
 *
 * These public types intentionally live in Shared instead of being re-exported
 * from the server-only license verifier. Besides keeping Node-only internals out
 * of browser declaration graphs, this prevents the verifier's schema tooling
 * from becoming an undeclared type dependency of every Shared consumer.
 */
export interface LicenseOwner {
  org_id: string;
  org_name: string;
  contact_email: string;
}

export interface LicenseFeatures {
  "threads.retention_hours"?: number;
  "threads.max_count"?: number;
  "sdk.angular"?: boolean;
  msteams?: boolean;
  [key: string]: boolean | number | undefined;
}

export type LicenseTier =
  | "free"
  | "developer"
  | "pro"
  | "team"
  | "team_self_hosted"
  | "enterprise";

export interface LicensePayload {
  version: number;
  license_id: string;
  key_id: string;
  telemetry_id: string;
  owner: LicenseOwner;
  issued_at: string;
  expires_at: string;
  tier: LicenseTier;
  catalog_version?: string;
  plan_code?: LicenseTier;
  entitlement_source?:
    | "enterprise_override"
    | "clerk_subscription"
    | "clerk_free_default";
  issuer?: string | null;
  supersedes_license_id?: string | null;
  replacement_reason?: string | null;
  seat_limit: number;
  features: LicenseFeatures;
  remove_branding: boolean;
}

export interface LicenseStatus {
  valid: boolean;
  license: LicensePayload | null;
  error:
    | "invalid_signature"
    | "expired"
    | "unknown_key"
    | "parse_error"
    | "key_mismatch"
    | null;
  graceRemaining?: number;
  warningSeverity: "none" | "info" | "warning" | "critical";
}

interface EntitlementReader {
  checkFeature(feature: string): boolean;
  getFeatureLimit(feature: string): number | null;
}

interface OrganizationEntitlement {
  active: boolean;
  features: Record<string, boolean | number>;
  planCode?: string;
  source?: string;
}

export interface LicenseChecker {
  getStatus(): LicenseStatus;
  checkFeature(feature: string): boolean;
  withOrganizationEntitlement(
    organization: OrganizationEntitlement,
  ): EntitlementReader;
}
