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

export const MANAGED_INACTIVE_RUNTIME_ENTITLEMENTS = {
  status: "ready",
  entitlement: {
    active: false,
    source: "managedOrgSubscription",
    features: {},
    limits: {},
  },
} as const satisfies RuntimeEntitlementResponse;

export const SELF_HOSTED_READY_RUNTIME_ENTITLEMENTS = {
  status: "ready",
  entitlement: {
    active: true,
    source: "selfHostedDeploymentLicense",
    features: { deployment_via_helm_chart: true },
    limits: { "threads.retention_hours": 336 },
    planCode: "team_self_hosted",
    entitlementSource: "enterprise_override",
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

/** Build a ready response case with only the supplied optional metadata. */
function readyContractCase(
  label: string,
  source: "managedOrgSubscription" | "selfHostedDeploymentLicense",
  optionalMetadata: {
    planCode?: string;
    entitlementSource?: string;
  },
  detailKeys: readonly string[],
): RuntimeEntitlementContractCase {
  return {
    label,
    response: {
      status: "ready",
      entitlement: {
        active: true,
        source,
        features: { msteams: true },
        limits: { "threads.retention_hours": 120 },
        ...optionalMetadata,
      },
    },
    topLevelKeys: ["entitlement", "status"],
    detailKeys,
  };
}

/** Build an error response case with only the supplied optional trace metadata. */
function errorContractCase(
  label: string,
  status: "degraded" | "misconfigured" | "unavailable",
  error: {
    code: string;
    message: string;
    retryable: boolean;
    requestId?: string;
    traceId?: string;
  },
  detailKeys: readonly string[],
): RuntimeEntitlementContractCase {
  return {
    label,
    response: { status, error },
    topLevelKeys: ["error", "status"],
    detailKeys,
  };
}

const REQUIRED_READY_DETAIL_KEYS = [
  "active",
  "features",
  "limits",
  "source",
] as const;

const REQUIRED_ERROR_DETAIL_KEYS = ["code", "message", "retryable"] as const;

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
    label: "ready managed inactive",
    response: MANAGED_INACTIVE_RUNTIME_ENTITLEMENTS,
    topLevelKeys: ["entitlement", "status"],
    detailKeys: REQUIRED_READY_DETAIL_KEYS,
  },
  {
    label: "ready self-hosted",
    response: SELF_HOSTED_READY_RUNTIME_ENTITLEMENTS,
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
  readyContractCase(
    "ready managed without planCode",
    "managedOrgSubscription",
    { entitlementSource: "clerk_subscription" },
    [...REQUIRED_READY_DETAIL_KEYS, "entitlementSource"],
  ),
  readyContractCase(
    "ready managed without entitlementSource",
    "managedOrgSubscription",
    { planCode: "pro" },
    [...REQUIRED_READY_DETAIL_KEYS, "planCode"],
  ),
  readyContractCase(
    "ready managed without planCode or entitlementSource",
    "managedOrgSubscription",
    {},
    REQUIRED_READY_DETAIL_KEYS,
  ),
  readyContractCase(
    "ready self-hosted without planCode",
    "selfHostedDeploymentLicense",
    { entitlementSource: "enterprise_override" },
    [...REQUIRED_READY_DETAIL_KEYS, "entitlementSource"],
  ),
  readyContractCase(
    "ready self-hosted without entitlementSource",
    "selfHostedDeploymentLicense",
    { planCode: "team_self_hosted" },
    [...REQUIRED_READY_DETAIL_KEYS, "planCode"],
  ),
  readyContractCase(
    "ready self-hosted without planCode or entitlementSource",
    "selfHostedDeploymentLicense",
    {},
    REQUIRED_READY_DETAIL_KEYS,
  ),
  errorContractCase(
    "degraded without requestId",
    "degraded",
    {
      code: "RUNTIME_ENTITLEMENTS_SELF_HOSTED_EXPIRED",
      message: "Self-hosted license has expired.",
      retryable: false,
      traceId: "trace-degraded",
    },
    [...REQUIRED_ERROR_DETAIL_KEYS, "traceId"],
  ),
  errorContractCase(
    "degraded without traceId",
    "degraded",
    {
      code: "RUNTIME_ENTITLEMENTS_SELF_HOSTED_EXPIRED",
      message: "Self-hosted license has expired.",
      retryable: false,
      requestId: "req-degraded",
    },
    [...REQUIRED_ERROR_DETAIL_KEYS, "requestId"],
  ),
  errorContractCase(
    "degraded without requestId or traceId",
    "degraded",
    {
      code: "RUNTIME_ENTITLEMENTS_SELF_HOSTED_EXPIRED",
      message: "Self-hosted license has expired.",
      retryable: false,
    },
    REQUIRED_ERROR_DETAIL_KEYS,
  ),
  errorContractCase(
    "misconfigured without requestId",
    "misconfigured",
    {
      code: "RUNTIME_ENTITLEMENTS_SELF_HOSTED_MISCONFIGURED",
      message: "Self-hosted license configuration is missing or invalid.",
      retryable: false,
      traceId: "trace-misconfigured",
    },
    [...REQUIRED_ERROR_DETAIL_KEYS, "traceId"],
  ),
  errorContractCase(
    "misconfigured without traceId",
    "misconfigured",
    {
      code: "RUNTIME_ENTITLEMENTS_SELF_HOSTED_MISCONFIGURED",
      message: "Self-hosted license configuration is missing or invalid.",
      retryable: false,
      requestId: "req-misconfigured",
    },
    [...REQUIRED_ERROR_DETAIL_KEYS, "requestId"],
  ),
  errorContractCase(
    "misconfigured without requestId or traceId",
    "misconfigured",
    {
      code: "RUNTIME_ENTITLEMENTS_SELF_HOSTED_MISCONFIGURED",
      message: "Self-hosted license configuration is missing or invalid.",
      retryable: false,
    },
    REQUIRED_ERROR_DETAIL_KEYS,
  ),
  errorContractCase(
    "unavailable without requestId",
    "unavailable",
    {
      code: "RUNTIME_ENTITLEMENTS_MANAGED_UNAVAILABLE",
      message: "Managed entitlement resolution is temporarily unavailable.",
      retryable: true,
      traceId: "trace-unavailable",
    },
    [...REQUIRED_ERROR_DETAIL_KEYS, "traceId"],
  ),
  errorContractCase(
    "unavailable without traceId",
    "unavailable",
    {
      code: "RUNTIME_ENTITLEMENTS_MANAGED_UNAVAILABLE",
      message: "Managed entitlement resolution is temporarily unavailable.",
      retryable: true,
      requestId: "req-unavailable",
    },
    [...REQUIRED_ERROR_DETAIL_KEYS, "requestId"],
  ),
  errorContractCase(
    "unavailable without requestId or traceId",
    "unavailable",
    {
      code: "RUNTIME_ENTITLEMENTS_MANAGED_UNAVAILABLE",
      message: "Managed entitlement resolution is temporarily unavailable.",
      retryable: true,
    },
    REQUIRED_ERROR_DETAIL_KEYS,
  ),
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
