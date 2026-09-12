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

/** Create a value promise whose completion the test controls. */
function deferredValue<T>(label: string): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolveValue: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (!resolveValue) {
        throw new Error(`Deferred ${label} resolved before initialization`);
      }
      resolveValue(value);
    },
  };
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

test("clears Runtime authority before connecting to a new target", async () => {
  const nextRuntimeResponse = deferredValue<Response>("next Runtime response");
  const fetchMock = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(runtimeInfoResponse(runtimeInfo()))
    .mockImplementationOnce(() => nextRuntimeResponse.promise);
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", fetchMock);
  const core = new CopilotKitCore({
    runtimeUrl: "https://a.example",
    runtimeTransport: "rest",
  });

  try {
    await waitForConnected(core);
    expect(readRuntimeAuthority(core)).toEqual({
      licenseStatus: "valid",
      runtimeEntitlements: initialRuntimeEntitlements,
    });

    core.setRuntimeUrl("https://b.example");
    const statusWhileConnecting = core.runtimeConnectionStatus;
    const authorityWhileConnecting = readRuntimeAuthority(core);

    nextRuntimeResponse.resolve(
      runtimeInfoResponse(
        runtimeInfo({
          licenseStatus: "expiring",
          runtimeEntitlements: refreshedRuntimeEntitlements,
          version: "B",
        }),
      ),
    );
    await waitForCondition(() => core.runtimeVersion === "B");

    expect(statusWhileConnecting).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connecting,
    );
    expect(authorityWhileConnecting).toEqual({
      licenseStatus: undefined,
      runtimeEntitlements: undefined,
    });
    expect(readRuntimeAuthority(core)).toEqual({
      licenseStatus: "expiring",
      runtimeEntitlements: refreshedRuntimeEntitlements,
    });
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
    expect(core.runtimeEntitlementRetryPending).toBe(true);

    await vi.advanceTimersByTimeAsync(5_000);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(readRuntimeAuthority(core)).toEqual({
        licenseStatus: "valid",
        runtimeEntitlements: initialRuntimeEntitlements,
      });
    });
    expect(core.runtimeEntitlementRetryPending).toBe(false);
  } finally {
    teardown();
    vi.useRealTimers();
  }
});

test("retries after a slow connected subscriber releases the first request", async () => {
  vi.useFakeTimers();
  const connectedSubscriber = deferredValue<void>("connected subscriber");
  const { core, fetchMock, teardown } = setupCore(
    runtimeInfoResponse(
      runtimeInfo({
        licenseStatus: "unknown",
        runtimeEntitlements: retryableRuntimeEntitlements,
      }),
    ),
    runtimeInfoResponse(runtimeInfo()),
  );
  let blockConnectedNotification = true;
  const subscription = core.subscribe({
    onRuntimeConnectionStatusChanged: ({ status }) => {
      if (
        blockConnectedNotification &&
        status === CopilotKitCoreRuntimeConnectionStatus.Connected
      ) {
        blockConnectedNotification = false;
        return connectedSubscriber.promise;
      }
    },
  });

  try {
    await vi.waitFor(() => {
      expect(core.runtimeEntitlementRetryPending).toBe(true);
    });

    await vi.advanceTimersByTimeAsync(5_000);

    expect(fetchMock).toHaveBeenCalledOnce();

    connectedSubscriber.resolve();
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(core.runtimeEntitlementRetryPending).toBe(false);
    });
  } finally {
    subscription.unsubscribe();
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
    expect(core.runtimeEntitlementRetryPending).toBe(false);
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

test("settles a bounded entitlement retry when the retry request fails", async () => {
  vi.useFakeTimers();
  const { core, fetchMock, teardown } = setupCore(
    runtimeInfoResponse(
      runtimeInfo({
        licenseStatus: "unknown",
        runtimeEntitlements: retryableRuntimeEntitlements,
      }),
    ),
    new Response("Runtime unavailable", {
      status: 503,
      headers: { "content-type": "text/plain" },
    }),
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
      expect(core.runtimeConnectionStatus).toBe(
        CopilotKitCoreRuntimeConnectionStatus.Error,
      );
    });

    expect(core.runtimeEntitlementRetryPending).toBe(false);
    expect(readRuntimeAuthority(core)).toEqual({
      licenseStatus: "unknown",
      runtimeEntitlements: retryableRuntimeEntitlements,
    });
  } finally {
    teardown();
    vi.useRealTimers();
  }
});

test("ignores stale Runtime authority and retries after the connection target changes", async () => {
  vi.useFakeTimers();
  const staleResponse = deferredValue<Response>("Runtime response");
  const fetchMock = vi.fn<typeof globalThis.fetch>();
  fetchMock
    .mockImplementationOnce(() => staleResponse.promise)
    .mockResolvedValueOnce(
      runtimeInfoResponse(
        runtimeInfo({
          licenseStatus: "expiring",
          runtimeEntitlements: refreshedRuntimeEntitlements,
          version: "B",
        }),
      ),
    );
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", fetchMock);
  const core = new CopilotKitCore({
    runtimeUrl: "https://a.example",
    runtimeTransport: "rest",
  });

  try {
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    core.setRuntimeUrl("https://b.example");
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(core.runtimeVersion).toBe("B");
    });

    staleResponse.resolve(
      runtimeInfoResponse(
        runtimeInfo({
          licenseStatus: "unknown",
          runtimeEntitlements: retryableRuntimeEntitlements,
          version: "A",
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(5_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      "https://a.example/info",
      "https://b.example/info",
    ]);
    expect(core.runtimeVersion).toBe("B");
    expect(readRuntimeAuthority(core)).toEqual({
      licenseStatus: "expiring",
      runtimeEntitlements: refreshedRuntimeEntitlements,
    });
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});

test("ignores an old Runtime response after reconnecting to the same target", async () => {
  vi.useFakeTimers();
  const staleResponse = deferredValue<Response>("Runtime response");
  const fetchMock = vi.fn<typeof globalThis.fetch>();
  fetchMock
    .mockImplementationOnce(() => staleResponse.promise)
    .mockResolvedValueOnce(
      runtimeInfoResponse(
        runtimeInfo({
          licenseStatus: "expiring",
          runtimeEntitlements: refreshedRuntimeEntitlements,
          version: "B",
        }),
      ),
    )
    .mockResolvedValueOnce(
      runtimeInfoResponse(
        runtimeInfo({
          licenseStatus: "valid",
          runtimeEntitlements: initialRuntimeEntitlements,
          version: "A-new",
        }),
      ),
    );
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", fetchMock);
  const core = new CopilotKitCore({
    runtimeUrl: "https://a.example",
    runtimeTransport: "rest",
  });

  try {
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    core.setRuntimeUrl("https://b.example");
    await vi.waitFor(() => {
      expect(core.runtimeVersion).toBe("B");
    });

    core.setRuntimeUrl("https://a.example");
    await vi.waitFor(() => {
      expect(core.runtimeVersion).toBe("A-new");
    });

    staleResponse.resolve(
      runtimeInfoResponse(
        runtimeInfo({
          licenseStatus: "unknown",
          runtimeEntitlements: retryableRuntimeEntitlements,
          version: "A-old",
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(5_000);

    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      "https://a.example/info",
      "https://b.example/info",
      "https://a.example/info",
    ]);
    expect(core.runtimeVersion).toBe("A-new");
    expect(readRuntimeAuthority(core)).toEqual({
      licenseStatus: "valid",
      runtimeEntitlements: initialRuntimeEntitlements,
    });
    expect(core.runtimeEntitlementRetryPending).toBe(false);
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
