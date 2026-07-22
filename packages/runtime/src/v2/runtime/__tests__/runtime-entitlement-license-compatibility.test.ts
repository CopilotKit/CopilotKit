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
  "keeps the $label legacy status when managed entitlements are active",
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
    expect(body.licenseStatus).toBe(
      legacyLicenseStatus.error === "expired" ? "expired" : "invalid",
    );
  },
);

test.each([
  {
    label: "inactive",
    runtimeEntitlements: {
      status: "ready",
      entitlement: {
        active: false,
        source: "managedOrgSubscription",
        features: {},
        limits: {},
      },
    } as RuntimeEntitlementResponse,
  },
  {
    label: "unavailable",
    runtimeEntitlements: {
      status: "unavailable",
      error: {
        code: "runtime_entitlements_unavailable",
        message: "Runtime entitlement lookup failed",
        retryable: true,
      },
    } as RuntimeEntitlementResponse,
  },
] satisfies ReadonlyArray<{
  label: string;
  runtimeEntitlements: RuntimeEntitlementResponse;
}>)(
  "does not grant the compatibility license for a $label entitlement result",
  async ({
    runtimeEntitlements,
  }: {
    runtimeEntitlements: RuntimeEntitlementResponse;
  }) => {
    const { runtime } = setup(runtimeEntitlements);

    const response = await handleGetRuntimeInfo({
      runtime,
      request: new Request("https://runtime.example/info"),
    });
    const body: RuntimeInfo = await response.json();

    expect(response.status).toBe(200);
    expect(body.licenseStatus).not.toBe("valid");
    expect(body.licenseStatus).not.toBe("expiring");
  },
);
