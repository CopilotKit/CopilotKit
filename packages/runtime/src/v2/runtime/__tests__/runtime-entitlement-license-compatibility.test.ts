import type {
  RuntimeEntitlementResponse,
  RuntimeInfo,
} from "@copilotkit/shared";
import { createLicenseChecker } from "@copilotkit/license-verifier";
import type { LicenseStatus } from "@copilotkit/license-verifier";
import { expect, test, vi } from "vitest";
import { CopilotRuntime } from "../core/runtime";
import { handleGetRuntimeInfo } from "../handlers/get-runtime-info";
import { CopilotKitIntelligence } from "../intelligence-platform";
import {
  findForbiddenPublicKeyPaths,
  RUNTIME_ENTITLEMENT_CONTRACT_CASES,
} from "./runtime-entitlement-test-utils";

test("normalizes the current flat managed entitlement transport through /info", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        organizationId: "org-private",
        source: "managedOrgSubscription",
        active: true,
        features: { threads: true },
        limits: { seats: 25 },
        planCode: "pro",
        entitlementSource: "stripe",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  try {
    const intelligence = new CopilotKitIntelligence({
      apiKey: "test-api-key",
      apiUrl: "https://runtime.example",
      wsUrl: "wss://runtime.example",
    });
    const runtime = new CopilotRuntime({
      agents: {},
      intelligence,
      identifyUser: () => ({ id: "user-1", name: "Test User" }),
    });

    const response = await handleGetRuntimeInfo({
      runtime,
      request: new Request("https://runtime.example/info"),
    });
    const body: RuntimeInfo = await response.json();

    expect(response.status).toBe(200);
    expect(body.licenseStatus).toBe("valid");
    expect(body.runtimeEntitlements).toEqual({
      status: "ready",
      entitlement: {
        source: "managedOrgSubscription",
        active: true,
        features: { threads: true },
        limits: { seats: 25 },
        planCode: "pro",
        entitlementSource: "stripe",
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});

test.each(RUNTIME_ENTITLEMENT_CONTRACT_CASES)(
  "preserves the exact public $label entitlement union through /info",
  async ({ response: runtimeEntitlements, topLevelKeys, detailKeys }) => {
    const { runtime } = setup(runtimeEntitlements);

    const response = await handleGetRuntimeInfo({
      runtime,
      request: new Request("https://runtime.example/info"),
    });
    const body: RuntimeInfo = await response.json();

    expect(body.runtimeEntitlements).toEqual(runtimeEntitlements);
    expect(Object.keys(body.runtimeEntitlements ?? {}).sort()).toEqual(
      [...topLevelKeys].sort(),
    );
    const detail =
      body.runtimeEntitlements?.entitlement ??
      body.runtimeEntitlements?.error ??
      {};
    expect(Object.keys(detail).sort()).toEqual([...detailKeys].sort());
    expect(findForbiddenPublicKeyPaths(body.runtimeEntitlements)).toEqual([]);
  },
);

/** Build an Intelligence runtime whose entitlement authority is deterministic. */
function setup(
  runtimeEntitlements: RuntimeEntitlementResponse,
  legacyLicenseStatus?: LicenseStatus,
) {
  const intelligence = new CopilotKitIntelligence({
    apiKey: "test-api-key",
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
  });
  const getRuntimeEntitlements = vi
    .spyOn(intelligence, "getRuntimeEntitlements")
    .mockResolvedValue(runtimeEntitlements);
  const runtime = new CopilotRuntime({
    agents: {},
    intelligence,
    identifyUser: () => ({ id: "user-1", name: "Test User" }),
  });
  if (legacyLicenseStatus) {
    const licenseChecker = createLicenseChecker();
    vi.spyOn(licenseChecker, "getStatus").mockReturnValue(legacyLicenseStatus);
    Object.defineProperty(runtime, "licenseChecker", {
      configurable: true,
      value: licenseChecker,
    });
  }

  return { getRuntimeEntitlements, runtime };
}

test("maps an active managed entitlement to the valid compatibility status", async () => {
  const { getRuntimeEntitlements, runtime } = setup({
    status: "ready",
    entitlement: {
      active: true,
      source: "managedOrgSubscription",
      features: { threads: true },
      limits: {},
    },
  });

  const response = await handleGetRuntimeInfo({
    runtime,
    request: new Request("https://runtime.example/info"),
  });
  const body: RuntimeInfo = await response.json();

  expect(response.status).toBe(200);
  expect(body.licenseStatus).toBe("valid");
  expect(getRuntimeEntitlements).toHaveBeenCalledOnce();
});

test.each([
  {
    label: "invalid",
    legacyLicenseStatus: {
      valid: false,
      license: null,
      error: "invalid_signature",
      warningSeverity: "critical",
    },
  },
  {
    label: "expired",
    legacyLicenseStatus: {
      valid: false,
      license: null,
      error: "expired",
      warningSeverity: "critical",
    },
  },
] satisfies ReadonlyArray<{
  label: string;
  legacyLicenseStatus: LicenseStatus;
}>)(
  "maps an active managed entitlement over the $label legacy status",
  async ({ legacyLicenseStatus }) => {
    const { runtime } = setup(
      {
        status: "ready",
        entitlement: {
          active: true,
          source: "managedOrgSubscription",
          features: { threads: true },
          limits: {},
        },
      },
      legacyLicenseStatus,
    );

    const response = await handleGetRuntimeInfo({
      runtime,
      request: new Request("https://runtime.example/info"),
    });
    const body: RuntimeInfo = await response.json();

    expect(response.status).toBe(200);
    expect(body.licenseStatus).toBe("valid");
  },
);

const nonActiveEntitlementCases: ReadonlyArray<{
  expectedStatus: RuntimeInfo["licenseStatus"];
  label: string;
  runtimeEntitlements: RuntimeEntitlementResponse;
}> = [
  {
    label: "inactive",
    expectedStatus: "none",
    runtimeEntitlements: {
      status: "ready",
      entitlement: {
        active: false,
        source: "managedOrgSubscription",
        features: {},
        limits: {},
      },
    },
  },
  {
    label: "unavailable",
    expectedStatus: "unknown",
    runtimeEntitlements: {
      status: "unavailable",
      error: {
        code: "runtime_entitlements_unavailable",
        message: "Runtime entitlement lookup failed",
        retryable: true,
      },
    },
  },
];

test.each(nonActiveEntitlementCases)(
  "maps a $label entitlement result to the $expectedStatus compatibility status",
  async ({ expectedStatus, runtimeEntitlements }) => {
    const { runtime } = setup(runtimeEntitlements);

    const response = await handleGetRuntimeInfo({
      runtime,
      request: new Request("https://runtime.example/info"),
    });
    const body: RuntimeInfo = await response.json();

    expect(response.status).toBe(200);
    expect(body.licenseStatus).toBe(expectedStatus);
  },
);
