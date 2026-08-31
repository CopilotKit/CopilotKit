import { TestBed } from "@angular/core/testing";
import type { RuntimeInfo } from "@copilotkit/shared";
import { expect, test, vi } from "vitest";
import { CopilotKit } from "./copilotkit";
import { provideCopilotKit } from "./config";

const RUNTIME_URL = "/runtime-entitlements-test";
const RUNTIME_INFO_URL = `${RUNTIME_URL}/info`;

function runtimeInfo(
  runtimeEntitlements: RuntimeInfo["runtimeEntitlements"],
): RuntimeInfo {
  return {
    version: "1.0.0",
    agents: {},
    audioFileTranscriptionEnabled: false,
    mode: "intelligence",
    licenseStatus:
      runtimeEntitlements?.status === "ready" ? "valid" : "unknown",
    runtimeEntitlements,
  };
}

/**
 * Create the Angular service against ordered Runtime info responses.
 */
function setupRuntimeEntitlementMirror(
  ...runtimeInfoResponses: [RuntimeInfo, ...RuntimeInfo[]]
): {
  copilotkit: CopilotKit;
  dispose: () => void;
  runtimeInfoRequestCount: () => number;
} {
  let runtimeInfoResponseIndex = 0;
  let runtimeInfoRequestCount = 0;
  const fetchMock = vi.fn<typeof globalThis.fetch>(async (input) => {
    const requestUrl = input instanceof Request ? input.url : input.toString();
    if (requestUrl !== RUNTIME_INFO_URL) {
      return new Response(null, { status: 404 });
    }

    runtimeInfoRequestCount += 1;
    const info =
      runtimeInfoResponses[
        Math.min(runtimeInfoResponseIndex, runtimeInfoResponses.length - 1)
      ];
    runtimeInfoResponseIndex += 1;
    return Promise.resolve(
      new Response(JSON.stringify(info), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideCopilotKit({ runtimeUrl: RUNTIME_URL })],
  });
  const copilotkit = TestBed.inject(CopilotKit);

  return {
    copilotkit,
    dispose() {
      TestBed.resetTestingModule();
      vi.unstubAllGlobals();
    },
    runtimeInfoRequestCount: () => runtimeInfoRequestCount,
  };
}

test("Angular mirrors structured entitlement authority through Core's bounded retry", async () => {
  vi.useFakeTimers();
  const retryableEntitlements: RuntimeInfo["runtimeEntitlements"] = {
    status: "unavailable",
    error: {
      code: "runtime_entitlements_unavailable",
      message: "Runtime entitlement lookup failed",
      retryable: true,
    },
  };
  const readyEntitlements: RuntimeInfo["runtimeEntitlements"] = {
    status: "ready",
    entitlement: {
      active: true,
      source: "managedOrgSubscription",
      planCode: "pro",
      features: { threads: true },
      limits: {},
    },
  };
  const { copilotkit, dispose, runtimeInfoRequestCount } =
    setupRuntimeEntitlementMirror(
      runtimeInfo(retryableEntitlements),
      runtimeInfo(readyEntitlements),
    );

  try {
    await vi.waitFor(() => {
      expect(runtimeInfoRequestCount()).toBe(1);
      expect(copilotkit.runtimeEntitlements()).toEqual(retryableEntitlements);
    });
    expect(copilotkit.runtimeEntitlementRetryPending()).toBe(true);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(runtimeInfoRequestCount()).toBe(2);
    expect(copilotkit.runtimeEntitlements()).toEqual(readyEntitlements);
    expect(copilotkit.runtimeEntitlementRetryPending()).toBe(false);
  } finally {
    dispose();
    vi.useRealTimers();
  }
});
