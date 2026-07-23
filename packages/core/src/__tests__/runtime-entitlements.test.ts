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

const initialRuntimeEntitlements: RuntimeEntitlementResponse = {
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

const refreshedRuntimeEntitlements: RuntimeEntitlementResponse = {
  status: "ready",
  entitlement: {
    active: true,
    source: "managedOrgSubscription",
    features: { msteams: false },
    limits: { "threads.retention_hours": 240 },
    planCode: "enterprise",
    entitlementSource: "clerk_subscription",
  },
};

const retryableRuntimeEntitlements: RuntimeEntitlementResponse = {
  status: "unavailable",
  error: {
    code: "runtime_entitlements_unavailable",
    message: "Runtime entitlement lookup failed",
    retryable: true,
  },
};

const nonRetryableRuntimeEntitlements: RuntimeEntitlementResponse = {
  status: "misconfigured",
  error: {
    code: "runtime_entitlements_misconfigured",
    message: "Runtime entitlement lookup is misconfigured",
    retryable: false,
  },
};

interface RuntimeInfoOptions {
  agents?: RuntimeInfo["agents"];
  includeRuntimeAuthority?: boolean;
  licenseStatus?: RuntimeLicenseStatus;
  runtimeEntitlements?: RuntimeEntitlementResponse;
  version?: string;
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
  includeRuntimeAuthority = true,
  licenseStatus = "valid",
  runtimeEntitlements:
    advertisedRuntimeEntitlements = initialRuntimeEntitlements,
  version = "1.0.0",
}: RuntimeInfoOptions = {}): RuntimeInfo {
  return {
    version,
    agents,
    audioFileTranscriptionEnabled: false,
    mode: "intelligence",
    intelligence: { wsUrl: "wss://runtime.example/client" },
    runtimeEntitlements: includeRuntimeAuthority
      ? advertisedRuntimeEntitlements
      : undefined,
    licenseStatus: includeRuntimeAuthority ? licenseStatus : undefined,
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

/** Read both typed public Runtime authority diagnostics. */
function readRuntimeAuthority(core: CopilotKitCore) {
  const runtimeEntitlements: RuntimeEntitlementResponse | undefined =
    core.runtimeEntitlements;
  const licenseStatus: RuntimeLicenseStatus | undefined = core.licenseStatus;

  return { licenseStatus, runtimeEntitlements };
}

test("ingests Runtime entitlements from `/info` through the typed public getter", async () => {
  const { core, fetchMock, teardown } = setupCore(
    runtimeInfoResponse(runtimeInfo()),
  );

  try {
    await waitForConnected(core);

    const authority = readRuntimeAuthority(core);

    expect(authority.licenseStatus).toBe("valid");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("https://runtime.example/info", {
      headers: {},
    });
    expect(authority.runtimeEntitlements).toEqual(initialRuntimeEntitlements);
  } finally {
    teardown();
  }
});

test("clears Runtime authority when the Runtime disconnects", async () => {
  const { core, teardown } = setupCore(runtimeInfoResponse(runtimeInfo()));

  try {
    await waitForConnected(core);
    expect(readRuntimeAuthority(core)).toEqual({
      licenseStatus: "valid",
      runtimeEntitlements: initialRuntimeEntitlements,
    });

    core.setRuntimeUrl(undefined);
    await waitForCondition(
      () =>
        core.runtimeConnectionStatus ===
        CopilotKitCoreRuntimeConnectionStatus.Disconnected,
    );

    expect(readRuntimeAuthority(core)).toEqual({
      licenseStatus: undefined,
      runtimeEntitlements: undefined,
    });
  } finally {
    teardown();
  }
});

test("clears Runtime authority when a refresh fails", async () => {
  const { core, teardown } = setupCore(
    runtimeInfoResponse(runtimeInfo()),
    new Response("Runtime unavailable", {
      status: 503,
      headers: { "content-type": "text/plain" },
    }),
  );

  try {
    await waitForConnected(core);
    expect(readRuntimeAuthority(core)).toEqual({
      licenseStatus: "valid",
      runtimeEntitlements: initialRuntimeEntitlements,
    });

    core.setRuntimeTransport("single");
    await waitForCondition(
      () =>
        core.runtimeConnectionStatus ===
        CopilotKitCoreRuntimeConnectionStatus.Error,
    );

    expect(readRuntimeAuthority(core)).toEqual({
      licenseStatus: undefined,
      runtimeEntitlements: undefined,
    });
  } finally {
    teardown();
  }
});

test("clears stale Runtime authority when a successful refresh omits it", async () => {
  const refreshedInfo = runtimeInfo({
    includeRuntimeAuthority: false,
    version: "2.0.0",
  });
  const { core, fetchMock, teardown } = setupCore(
    runtimeInfoResponse(runtimeInfo()),
    runtimeInfoResponse(refreshedInfo),
  );

  try {
    await waitForConnected(core);
    expect(readRuntimeAuthority(core)).toEqual({
      licenseStatus: "valid",
      runtimeEntitlements: initialRuntimeEntitlements,
    });

    core.setRuntimeTransport("single");
    await waitForCondition(() => fetchMock.mock.calls.length === 2);
    await waitForCondition(() => core.runtimeVersion === "2.0.0");

    expect(readRuntimeAuthority(core)).toEqual({
      licenseStatus: undefined,
      runtimeEntitlements: undefined,
    });
  } finally {
    teardown();
  }
});

test("keeps updated Runtime authority when a refresh removes an agent", async () => {
  const refreshedInfo = runtimeInfo({
    agents: {},
    licenseStatus: "expiring",
    runtimeEntitlements: refreshedRuntimeEntitlements,
    version: "2.0.0",
  });
  const { core, fetchMock, teardown } = setupCore(
    runtimeInfoResponse(runtimeInfo()),
    runtimeInfoResponse(refreshedInfo),
  );

  try {
    await waitForConnected(core);
    expect(readRuntimeAuthority(core)).toEqual({
      licenseStatus: "valid",
      runtimeEntitlements: initialRuntimeEntitlements,
    });

    core.setRuntimeTransport("single");
    await waitForCondition(() => fetchMock.mock.calls.length === 2);
    await waitForCondition(() => core.runtimeVersion === "2.0.0");
    await waitForCondition(() => core.agents.assistant === undefined);

    expect(readRuntimeAuthority(core)).toEqual({
      licenseStatus: "expiring",
      runtimeEntitlements: refreshedRuntimeEntitlements,
    });
  } finally {
    teardown();
  }
});

test("retries a transient Runtime entitlement result once without a reconnect", async () => {
  vi.useFakeTimers();
  const { core, fetchMock, teardown } = setupCore(
    runtimeInfoResponse(
      runtimeInfo({
        licenseStatus: "unknown",
        runtimeEntitlements: retryableRuntimeEntitlements,
      }),
    ),
    runtimeInfoResponse(runtimeInfo()),
  );

  try {
    await vi.waitFor(() => {
      expect(core.runtimeConnectionStatus).toBe(
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      );
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(readRuntimeAuthority(core)).toEqual({
      licenseStatus: "unknown",
      runtimeEntitlements: retryableRuntimeEntitlements,
    });

    await vi.advanceTimersByTimeAsync(5_000);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(readRuntimeAuthority(core)).toEqual({
        licenseStatus: "valid",
        runtimeEntitlements: initialRuntimeEntitlements,
      });
    });
  } finally {
    teardown();
    vi.useRealTimers();
  }
});

test("does not retry a non-retryable Runtime entitlement result", async () => {
  vi.useFakeTimers();
  const { core, fetchMock, teardown } = setupCore(
    runtimeInfoResponse(
      runtimeInfo({
        licenseStatus: "none",
        runtimeEntitlements: nonRetryableRuntimeEntitlements,
      }),
    ),
  );

  try {
    await vi.waitFor(() => {
      expect(core.runtimeConnectionStatus).toBe(
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      );
    });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(readRuntimeAuthority(core)).toEqual({
      licenseStatus: "none",
      runtimeEntitlements: nonRetryableRuntimeEntitlements,
    });
  } finally {
    teardown();
    vi.useRealTimers();
  }
});

test("bounds automatic recovery to one retry for a persistent outage", async () => {
  vi.useFakeTimers();
  const transientInfo = runtimeInfoResponse(
    runtimeInfo({
      licenseStatus: "unknown",
      runtimeEntitlements: retryableRuntimeEntitlements,
    }),
  );
  const { core, fetchMock, teardown } = setupCore(
    transientInfo,
    runtimeInfoResponse(
      runtimeInfo({
        licenseStatus: "unknown",
        runtimeEntitlements: retryableRuntimeEntitlements,
      }),
    ),
  );

  try {
    await vi.waitFor(() => {
      expect(core.runtimeConnectionStatus).toBe(
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      );
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readRuntimeAuthority(core)).toEqual({
      licenseStatus: "unknown",
      runtimeEntitlements: retryableRuntimeEntitlements,
    });
  } finally {
    teardown();
    vi.useRealTimers();
  }
});
