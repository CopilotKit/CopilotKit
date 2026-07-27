import { TestBed } from "@angular/core/testing";
import type { RuntimeInfo } from "@copilotkit/shared";
import { expect, test, vi } from "vitest";
import { CopilotKit } from "./copilotkit";
import { provideCopilotKit } from "./config";

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
  fetchMock: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
} {
  const fetchMock = vi.fn<typeof globalThis.fetch>();
  for (const info of runtimeInfoResponses) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(info), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }
  vi.stubGlobal("fetch", fetchMock);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideCopilotKit({ runtimeUrl: "/api" })],
  });
  const copilotkit = TestBed.inject(CopilotKit);

  return {
    copilotkit,
    dispose() {
      TestBed.resetTestingModule();
      vi.unstubAllGlobals();
    },
    fetchMock,
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
  const { copilotkit, dispose, fetchMock } = setupRuntimeEntitlementMirror(
    runtimeInfo(retryableEntitlements),
    runtimeInfo(readyEntitlements),
  );

  try {
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(copilotkit.runtimeEntitlements()).toEqual(retryableEntitlements);
    expect(copilotkit.runtimeEntitlementRetryPending()).toBe(true);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(copilotkit.runtimeEntitlements()).toEqual(readyEntitlements);
    expect(copilotkit.runtimeEntitlementRetryPending()).toBe(false);
  } finally {
    dispose();
    vi.useRealTimers();
  }
});
