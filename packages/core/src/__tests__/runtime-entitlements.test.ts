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
import { CopilotKitCore, CopilotKitCoreRuntimeConnectionStatus } from "../core";
import { waitForCondition } from "./test-utils";

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

interface RuntimeInfoOptions {
  agents?: RuntimeInfo["agents"];
  includeRuntimeEntitlements?: boolean;
}

/** Build a complete Runtime `/info` response with structured entitlements. */
function runtimeInfo({
  agents = {
    assistant: {
      name: "assistant",
      className: "HttpAgent",
      description: "Assistant",
    },
  },
  includeRuntimeEntitlements = true,
}: RuntimeInfoOptions = {}): RuntimeInfo {
  return {
    version: "1.0.0",
    agents,
    audioFileTranscriptionEnabled: false,
    mode: "intelligence",
    intelligence: { wsUrl: "wss://runtime.example/client" },
    runtimeEntitlements: includeRuntimeEntitlements
      ? runtimeEntitlements
      : undefined,
    licenseStatus: "valid",
  };
}

/** Encode one Runtime info result as a real JSON response. */
function runtimeInfoResponse(info: RuntimeInfo): Response {
  return new Response(JSON.stringify(info), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Create an isolated browser-like Core with ordered Runtime responses. */
function setupCore(...responses: [Response, ...Response[]]) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", fetchMock);

  const core = new CopilotKitCore({
    runtimeUrl: "https://runtime.example",
    runtimeTransport: "rest",
  });

  return {
    core,
    fetchMock,
    teardown: () => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    },
  };
}

/** Wait until the initial Runtime info response has been ingested. */
async function waitForConnected(core: CopilotKitCore): Promise<void> {
  await waitForCondition(
    () =>
      core.runtimeConnectionStatus ===
      CopilotKitCoreRuntimeConnectionStatus.Connected,
  );
}

/** Read the typed public entitlement state without duplicating access logic. */
function readRuntimeEntitlements(
  core: CopilotKitCore,
): RuntimeEntitlementResponse | undefined {
  return core.runtimeEntitlements;
}

test("ingests Runtime entitlements from `/info` through the typed public getter", async () => {
  const { core, fetchMock, teardown } = setupCore(
    runtimeInfoResponse(runtimeInfo()),
  );

  try {
    await waitForConnected(core);

    const legacyLicenseStatus: RuntimeLicenseStatus | undefined =
      core.licenseStatus;
    const publicRuntimeEntitlements = readRuntimeEntitlements(core);

    expect(legacyLicenseStatus).toBe("valid");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("https://runtime.example/info", {
      headers: {},
    });
    expect(publicRuntimeEntitlements).toEqual(runtimeEntitlements);
  } finally {
    teardown();
  }
});

test("clears Runtime entitlements when the Runtime disconnects", async () => {
  const { core, teardown } = setupCore(runtimeInfoResponse(runtimeInfo()));

  try {
    await waitForConnected(core);
    expect(readRuntimeEntitlements(core)).toEqual(runtimeEntitlements);

    core.setRuntimeUrl(undefined);
    await waitForCondition(
      () =>
        core.runtimeConnectionStatus ===
        CopilotKitCoreRuntimeConnectionStatus.Disconnected,
    );

    expect(readRuntimeEntitlements(core)).toBeUndefined();
  } finally {
    teardown();
  }
});

test("clears Runtime entitlements when a refresh fails", async () => {
  const { core, teardown } = setupCore(
    runtimeInfoResponse(runtimeInfo()),
    new Response("Runtime unavailable", {
      status: 503,
      headers: { "content-type": "text/plain" },
    }),
  );

  try {
    await waitForConnected(core);
    expect(readRuntimeEntitlements(core)).toEqual(runtimeEntitlements);

    core.setRuntimeTransport("single");
    await waitForCondition(
      () =>
        core.runtimeConnectionStatus ===
        CopilotKitCoreRuntimeConnectionStatus.Error,
    );

    expect(readRuntimeEntitlements(core)).toBeUndefined();
  } finally {
    teardown();
  }
});

test("clears Runtime entitlements when a refresh removes the advertised agent", async () => {
  const refreshedInfo = runtimeInfo({
    agents: {},
    includeRuntimeEntitlements: false,
  });
  const { core, fetchMock, teardown } = setupCore(
    runtimeInfoResponse(runtimeInfo()),
    runtimeInfoResponse(refreshedInfo),
  );

  try {
    await waitForConnected(core);
    expect(readRuntimeEntitlements(core)).toEqual(runtimeEntitlements);

    core.setRuntimeTransport("single");
    await waitForCondition(() => fetchMock.mock.calls.length === 2);
    await waitForCondition(() => core.agents.assistant === undefined);

    expect(readRuntimeEntitlements(core)).toBeUndefined();
    expect(core.licenseStatus).toBe("valid");
  } finally {
    teardown();
  }
});
