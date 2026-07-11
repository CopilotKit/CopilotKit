/**
 * Specifies that structured Runtime entitlement state advertised by `/info`
 * is retained by Core and exposed alongside the legacy license status.
 */
import { expect, test, vi } from "vitest";
import type {
  RuntimeEntitlementResponse,
  RuntimeInfo,
  RuntimeLicenseStatus,
} from "@copilotkit/shared";
import { CopilotKitCore } from "../core";
import { waitForCondition } from "./test-utils";

test("ingests Runtime entitlements from `/info` through the typed public getter", async () => {
  const runtimeEntitlements: RuntimeEntitlementResponse = {
    status: "ready",
    entitlement: {
      active: true,
      source: "managedOrgSubscription",
      features: { msteams: true },
      limits: { "threads.retention_hours": 120 },
      planCode: "pro",
      entitlementSource: "clerk_subscription",
    },
  };
  const runtimeInfo: RuntimeInfo = {
    version: "1.0.0",
    agents: {},
    audioFileTranscriptionEnabled: false,
    mode: "intelligence",
    intelligence: { wsUrl: "wss://runtime.example/client" },
    runtimeEntitlements,
    licenseStatus: "valid",
  };
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(runtimeInfo), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", fetchMock);

  try {
    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      runtimeTransport: "rest",
    });
    await waitForCondition(() => core.runtimeVersion !== undefined);

    const legacyLicenseStatus: RuntimeLicenseStatus | undefined =
      core.licenseStatus;
    const publicRuntimeEntitlements: RuntimeEntitlementResponse | undefined =
      core.runtimeEntitlements;

    expect(legacyLicenseStatus).toBe("valid");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("https://runtime.example/info", {
      headers: {},
    });
    expect(publicRuntimeEntitlements).toEqual(runtimeEntitlements);
  } finally {
    vi.unstubAllGlobals();
  }
});
