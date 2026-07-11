import type { RuntimeEntitlementResponse } from "@copilotkit/shared";

export const READY_RUNTIME_ENTITLEMENTS = {
  status: "ready",
  entitlement: {
    active: true,
    source: "managedOrgSubscription",
    features: { msteams: true },
    limits: { "threads.retention_hours": 120 },
    planCode: "pro",
    entitlementSource: "clerk_subscription",
  },
} as const satisfies RuntimeEntitlementResponse;

export const DEGRADED_RUNTIME_ENTITLEMENTS = {
  status: "degraded",
  error: {
    code: "RUNTIME_ENTITLEMENTS_SELF_HOSTED_EXPIRED",
    message: "Self-hosted license has expired.",
    retryable: false,
    requestId: "req-degraded",
    traceId: "trace-degraded",
  },
} as const satisfies RuntimeEntitlementResponse;

export const MISCONFIGURED_RUNTIME_ENTITLEMENTS = {
  status: "misconfigured",
  error: {
    code: "RUNTIME_ENTITLEMENTS_SELF_HOSTED_MISCONFIGURED",
    message: "Self-hosted license configuration is missing or invalid.",
    retryable: false,
    requestId: "req-misconfigured",
    traceId: "trace-misconfigured",
  },
} as const satisfies RuntimeEntitlementResponse;

export const UNAVAILABLE_RUNTIME_ENTITLEMENTS = {
  status: "unavailable",
  error: {
    code: "RUNTIME_ENTITLEMENTS_MANAGED_UNAVAILABLE",
    message: "Managed entitlement resolution is temporarily unavailable.",
    retryable: true,
    requestId: "req-unavailable",
    traceId: "trace-unavailable",
  },
} as const satisfies RuntimeEntitlementResponse;

interface RuntimeEntitlementContractCase {
  label: string;
  response: RuntimeEntitlementResponse;
  topLevelKeys: readonly string[];
  detailKeys: readonly string[];
}

export const RUNTIME_ENTITLEMENT_CONTRACT_CASES = [
  {
    label: "ready",
    response: READY_RUNTIME_ENTITLEMENTS,
    topLevelKeys: ["entitlement", "status"],
    detailKeys: [
      "active",
      "entitlementSource",
      "features",
      "limits",
      "planCode",
      "source",
    ],
  },
  {
    label: "degraded",
    response: DEGRADED_RUNTIME_ENTITLEMENTS,
    topLevelKeys: ["error", "status"],
    detailKeys: ["code", "message", "requestId", "retryable", "traceId"],
  },
  {
    label: "misconfigured",
    response: MISCONFIGURED_RUNTIME_ENTITLEMENTS,
    topLevelKeys: ["error", "status"],
    detailKeys: ["code", "message", "requestId", "retryable", "traceId"],
  },
  {
    label: "unavailable",
    response: UNAVAILABLE_RUNTIME_ENTITLEMENTS,
    topLevelKeys: ["error", "status"],
    detailKeys: ["code", "message", "requestId", "retryable", "traceId"],
  },
] as const satisfies readonly RuntimeEntitlementContractCase[];

const FORBIDDEN_PUBLIC_KEYS = new Set([
  "organizationId",
  "organization_id",
  "telemetryId",
  "telemetry_id",
  "licenseToken",
  "license_token",
]);

/**
 * Find forbidden identity and credential keys at every depth of a public value.
 *
 * @param value - Unknown public response projection to inspect recursively.
 * @param path - Current JSON-style path used in actionable assertion output.
 * @returns Every forbidden key path in deterministic traversal order.
 */
export function findForbiddenPublicKeyPaths(
  value: unknown,
  path = "$",
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findForbiddenPublicKeyPaths(item, `${path}[${index}]`),
    );
  }
  if (value === null || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const nestedPath = `${path}.${key}`;
    return [
      ...(FORBIDDEN_PUBLIC_KEYS.has(key) ? [nestedPath] : []),
      ...findForbiddenPublicKeyPaths(nestedValue, nestedPath),
    ];
  });
}
