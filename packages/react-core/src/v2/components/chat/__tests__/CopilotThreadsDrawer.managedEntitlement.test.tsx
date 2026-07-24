import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type {
  RuntimeEntitlementResponse,
  RuntimeInfo,
} from "@copilotkit/shared";
import { COPILOTKIT_THREADS_DRAWER_TAG } from "@copilotkit/web-components/threads-drawer";
import type { CopilotKitThreadsDrawer as CopilotKitThreadsDrawerElement } from "@copilotkit/web-components/threads-drawer";
import { expect, test, vi } from "vitest";
import type {
  UseThreadsInput,
  UseThreadsResult,
} from "../../../hooks/use-threads";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import {
  CopilotKitProvider,
  useLicenseContext,
} from "../../../providers/CopilotKitProvider";
import { CopilotThreadsDrawer } from "../CopilotThreadsDrawer";

const useThreadsMock = vi.fn<(input: UseThreadsInput) => UseThreadsResult>();
const retryableRuntimeEntitlements: RuntimeEntitlementResponse = {
  status: "unavailable",
  error: {
    code: "runtime_entitlements_unavailable",
    message: "Runtime entitlement lookup failed",
    retryable: true,
  },
};

vi.mock("../../../hooks/use-threads", () => ({
  useThreads: (input: UseThreadsInput) => useThreadsMock(input),
}));

/**
 * Build Runtime info with an active managed entitlement and thread grant.
 */
function managedRuntimeInfo(threadsEnabled: boolean): RuntimeInfo {
  return {
    version: "1.0.0",
    agents: {},
    audioFileTranscriptionEnabled: false,
    mode: "intelligence",
    licenseStatus: "valid",
    runtimeEntitlements: {
      status: "ready",
      entitlement: {
        active: true,
        source: "managedOrgSubscription",
        planCode: "pro",
        features: { threads: threadsEnabled },
        limits: {},
      },
    },
  };
}

/** Build Runtime info for a retryable managed-entitlement outage. */
function retryableRuntimeInfo(
  licenseStatus: RuntimeInfo["licenseStatus"] = "unknown",
): RuntimeInfo {
  return {
    ...managedRuntimeInfo(true),
    licenseStatus,
    runtimeEntitlements: retryableRuntimeEntitlements,
  };
}

/** Build Runtime info for a terminal managed-entitlement failure. */
function terminalRuntimeInfo(
  status: "degraded" | "misconfigured",
  licenseStatus: RuntimeInfo["licenseStatus"] = "none",
): RuntimeInfo {
  return {
    ...managedRuntimeInfo(true),
    licenseStatus,
    runtimeEntitlements: {
      status,
      error: {
        code: `runtime_entitlements_${status}`,
        message: `Runtime entitlement lookup is ${status}`,
        retryable: false,
      },
    },
  };
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

/** Set up ordered Runtime info responses and an inert thread store. */
function setupDrawerTest(
  ...runtimeInfoResponses: [RuntimeInfo, ...RuntimeInfo[]]
) {
  const fetchMock = vi.fn<typeof globalThis.fetch>();
  for (const runtimeInfo of runtimeInfoResponses) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(runtimeInfo), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }
  useThreadsMock.mockReset();
  useThreadsMock.mockReturnValue({
    threads: [],
    isLoading: false,
    error: null,
    listError: null,
    fetchMoreError: null,
    hasMoreThreads: false,
    isFetchingMoreThreads: false,
    isMutating: false,
    archiveThread: vi.fn(),
    unarchiveThread: vi.fn(),
    deleteThread: vi.fn(),
    renameThread: vi.fn(),
    fetchMoreThreads: vi.fn(),
    refetchThreads: vi.fn(),
    startNewThread: vi.fn(),
  });
  vi.stubGlobal("fetch", fetchMock);

  return {
    fetchMock,
    dispose() {
      cleanup();
      vi.unstubAllGlobals();
      useThreadsMock.mockReset();
    },
  };
}

/**
 * Set up an active managed entitlement with the requested thread grant.
 */
function setupManagedEntitlementDrawerTest(threadsEnabled: boolean) {
  return setupDrawerTest(managedRuntimeInfo(threadsEnabled));
}

/** Flush promise-driven Core and React updates without advancing retry time. */
async function flushPromiseUpdates(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Render only the feature decision exposed to React consumers. */
function FeatureProbe(): React.ReactElement {
  const { checkFeature } = useLicenseContext();

  return <div data-testid="feature-probe">{String(checkFeature("chat"))}</div>;
}

test("a ready inactive entitlement denies feature-only React consumers", async () => {
  const { dispose } = setupDrawerTest({
    ...managedRuntimeInfo(true),
    licenseStatus: "none",
    runtimeEntitlements: {
      status: "ready",
      entitlement: {
        active: false,
        source: "managedOrgSubscription",
        planCode: "pro",
        features: { chat: true },
        limits: {},
      },
    },
  });

  try {
    render(
      <CopilotKitProvider runtimeUrl="/api">
        <FeatureProbe />
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("feature-probe").textContent).toBe("false");
    });
  } finally {
    dispose();
  }
});

test.each(["misconfigured", "degraded"] as const)(
  "a terminal %s entitlement result denies feature-only React consumers without a legacy fallback",
  async (status) => {
    const { dispose } = setupDrawerTest(terminalRuntimeInfo(status));

    try {
      render(
        <CopilotKitProvider runtimeUrl="/api">
          <FeatureProbe />
        </CopilotKitProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("feature-probe").textContent).toBe("false");
      });
    } finally {
      dispose();
    }
  },
);

test.each(["valid", "expiring"] as const)(
  "a terminal managed failure preserves a legacy fallback with status %s",
  async (licenseStatus) => {
    const { dispose } = setupDrawerTest(
      terminalRuntimeInfo("misconfigured", licenseStatus),
    );

    try {
      render(
        <CopilotKitProvider runtimeUrl="/api">
          <ThreadsFeatureProbe />
        </CopilotKitProvider>,
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("threads-feature-authority").textContent,
        ).toBe(`status:${licenseStatus} threads:true`);
      });
    } finally {
      dispose();
    }
  },
);

/** Show the status and feature policy exposed to feature-only consumers. */
function ThreadsFeatureProbe(): React.ReactElement {
  const { status, checkFeature } = useLicenseContext();
  return (
    <div data-testid="threads-feature-authority">
      {`status:${status ?? "null"} threads:${checkFeature("threads")}`}
    </div>
  );
}

test("managed entitlements keep the drawer locked when threads are denied", async () => {
  const { dispose } = setupManagedEntitlementDrawerTest(false);

  try {
    render(
      <CopilotKitProvider runtimeUrl="/api">
        <CopilotChatConfigurationProvider>
          <CopilotThreadsDrawer />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      expect(useThreadsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: false }),
      );
      const drawer = document.querySelector(
        COPILOTKIT_THREADS_DRAWER_TAG,
      ) as CopilotKitThreadsDrawerElement | null;
      expect(drawer?.licensed).toBe(false);
    });

    expect(
      screen.queryByText(
        /Powered by CopilotKit|CopilotKit license (?:expired|expires)|Invalid CopilotKit license token/i,
      ),
    ).toBeNull();
  } finally {
    dispose();
  }
});

test("managed entitlements load the drawer when threads are granted", async () => {
  const { dispose } = setupManagedEntitlementDrawerTest(true);

  try {
    render(
      <CopilotKitProvider runtimeUrl="/api">
        <CopilotChatConfigurationProvider>
          <CopilotThreadsDrawer />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      expect(useThreadsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: true }),
      );
      const drawer = document.querySelector(
        COPILOTKIT_THREADS_DRAWER_TAG,
      ) as CopilotKitThreadsDrawerElement | null;
      expect(drawer?.licensed).toBe(true);
    });

    expect(
      screen.queryByText(
        /Powered by CopilotKit|CopilotKit license (?:expired|expires)|Invalid CopilotKit license token/i,
      ),
    ).toBeNull();
  } finally {
    dispose();
  }
});

test.each([
  { label: "missing", licenseStatus: undefined },
  { label: "invalid", licenseStatus: "invalid" as const },
  { label: "expired", licenseStatus: "expired" as const },
])(
  "an active managed entitlement overrides a $label legacy status",
  async ({ licenseStatus }) => {
    const { dispose } = setupDrawerTest({
      ...managedRuntimeInfo(true),
      licenseStatus,
    });

    try {
      render(
        <CopilotKitProvider runtimeUrl="/api">
          <CopilotChatConfigurationProvider>
            <ThreadsFeatureProbe />
            <CopilotThreadsDrawer />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      await waitFor(() => {
        expect(useThreadsMock).toHaveBeenLastCalledWith(
          expect.objectContaining({ enabled: true }),
        );
        expect(
          screen.getByTestId("threads-feature-authority").textContent,
        ).toBe("status:valid threads:true");
        const drawer = document.querySelector<CopilotKitThreadsDrawerElement>(
          COPILOTKIT_THREADS_DRAWER_TAG,
        );
        expect(drawer?.licensed).toBe(true);
      });

      expect(
        screen.queryByText(
          /Powered by CopilotKit|CopilotKit license (?:expired|expires)|Invalid CopilotKit license token/i,
        ),
      ).toBeNull();
    } finally {
      dispose();
    }
  },
);

test.each(["valid", "expiring"] as const)(
  "an inactive self-hosted entitlement preserves a %s legacy drawer fallback",
  async (licenseStatus) => {
    const { dispose } = setupDrawerTest({
      ...managedRuntimeInfo(false),
      licenseStatus,
      runtimeEntitlements: {
        status: "ready",
        entitlement: {
          active: false,
          source: "selfHostedDeploymentLicense",
          features: { threads: false },
          limits: {},
        },
      },
    });

    try {
      render(
        <CopilotKitProvider runtimeUrl="/api">
          <CopilotChatConfigurationProvider>
            <ThreadsFeatureProbe />
            <CopilotThreadsDrawer />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      await waitFor(() => {
        expect(useThreadsMock).toHaveBeenLastCalledWith(
          expect.objectContaining({ enabled: true }),
        );
        expect(
          screen.getByTestId("threads-feature-authority").textContent,
        ).toBe(`status:${licenseStatus} threads:true`);
        const drawer = document.querySelector<CopilotKitThreadsDrawerElement>(
          COPILOTKIT_THREADS_DRAWER_TAG,
        );
        expect(drawer?.licensed).toBe(true);
      });
    } finally {
      dispose();
    }
  },
);

test("changing Runtime targets removes the previous thread grant while the next target is pending", async () => {
  const nextRuntimeResponse = deferredValue<Response>("next Runtime response");
  const { dispose, fetchMock } = setupDrawerTest(managedRuntimeInfo(true));
  fetchMock.mockImplementationOnce(() => nextRuntimeResponse.promise);

  try {
    const { rerender } = render(
      <CopilotKitProvider runtimeUrl="/api/a">
        <CopilotChatConfigurationProvider>
          <ThreadsFeatureProbe />
          <CopilotThreadsDrawer />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      expect(useThreadsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: true }),
      );
    });

    rerender(
      <CopilotKitProvider runtimeUrl="/api/b">
        <CopilotChatConfigurationProvider>
          <ThreadsFeatureProbe />
          <CopilotThreadsDrawer />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(useThreadsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: false }),
      );
      expect(screen.getByTestId("threads-feature-authority").textContent).toBe(
        "status:null threads:true",
      );
    });

    const pendingDrawer =
      document.querySelector<CopilotKitThreadsDrawerElement>(
        COPILOTKIT_THREADS_DRAWER_TAG,
      );
    expect(pendingDrawer?.loading).toBe(true);

    nextRuntimeResponse.resolve(
      new Response(JSON.stringify(managedRuntimeInfo(false)), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("threads-feature-authority").textContent).toBe(
        "status:valid threads:false",
      );
    });
  } finally {
    dispose();
  }
});

test("a retryable entitlement result stays pending until the mounted drawer recovers", async () => {
  vi.useFakeTimers();
  const { dispose, fetchMock } = setupDrawerTest(
    retryableRuntimeInfo(),
    managedRuntimeInfo(true),
  );

  try {
    render(
      <CopilotKitProvider runtimeUrl="/api">
        <CopilotChatConfigurationProvider>
          <CopilotThreadsDrawer />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await flushPromiseUpdates();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(useThreadsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    const pendingDrawer = document.querySelector(
      COPILOTKIT_THREADS_DRAWER_TAG,
    ) as CopilotKitThreadsDrawerElement | null;
    expect(pendingDrawer?.licensed).toBe(true);
    expect(
      screen.queryByText(
        /Powered by CopilotKit|CopilotKit license (?:expired|expires)|Invalid CopilotKit license token/i,
      ),
    ).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useThreadsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true }),
    );
    const recoveredDrawer = document.querySelector(
      COPILOTKIT_THREADS_DRAWER_TAG,
    ) as CopilotKitThreadsDrawerElement | null;
    expect(recoveredDrawer?.licensed).toBe(true);
  } finally {
    dispose();
    vi.useRealTimers();
  }
});

test.each(["invalid", "expired"] as const)(
  "a retryable entitlement result hides a stale %s license warning while managed authority recovers",
  async (licenseStatus) => {
    vi.useFakeTimers();
    const { dispose, fetchMock } = setupDrawerTest(
      retryableRuntimeInfo(licenseStatus),
      managedRuntimeInfo(true),
    );

    try {
      render(
        <CopilotKitProvider runtimeUrl="/api">
          <CopilotChatConfigurationProvider>
            <CopilotThreadsDrawer />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      await flushPromiseUpdates();

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(
        screen.queryByText(
          /CopilotKit license (?:expired|expires)|Invalid CopilotKit license token/i,
        ),
      ).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(useThreadsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: true }),
      );
      expect(
        screen.queryByText(
          /CopilotKit license (?:expired|expires)|Invalid CopilotKit license token/i,
        ),
      ).toBeNull();
    } finally {
      dispose();
      vi.useRealTimers();
    }
  },
);

test("a retryable managed outage preserves a valid legacy fallback through the bounded retry", async () => {
  vi.useFakeTimers();
  const { dispose, fetchMock } = setupDrawerTest(
    retryableRuntimeInfo("valid"),
    retryableRuntimeInfo("valid"),
  );

  try {
    render(
      <CopilotKitProvider runtimeUrl="/api">
        <CopilotChatConfigurationProvider>
          <ThreadsFeatureProbe />
          <CopilotThreadsDrawer />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await flushPromiseUpdates();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByTestId("threads-feature-authority").textContent).toBe(
      "status:valid threads:true",
    );
    expect(useThreadsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("threads-feature-authority").textContent).toBe(
      "status:valid threads:true",
    );
    expect(useThreadsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true }),
    );
    expect(
      screen.queryByText(
        /Powered by CopilotKit|CopilotKit license (?:expired|expires)|Invalid CopilotKit license token/i,
      ),
    ).toBeNull();
  } finally {
    dispose();
    vi.useRealTimers();
  }
});

test("a persistent retryable outage becomes terminal after the bounded retry", async () => {
  vi.useFakeTimers();
  const { dispose, fetchMock } = setupDrawerTest(
    retryableRuntimeInfo(),
    retryableRuntimeInfo(),
  );

  try {
    render(
      <CopilotKitProvider runtimeUrl="/api">
        <CopilotChatConfigurationProvider>
          <ThreadsFeatureProbe />
          <CopilotThreadsDrawer />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await flushPromiseUpdates();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(useThreadsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    const pendingDrawer =
      document.querySelector<CopilotKitThreadsDrawerElement>(
        COPILOTKIT_THREADS_DRAWER_TAG,
      );
    expect(pendingDrawer?.loading).toBe(true);
    expect(pendingDrawer?.licensed).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useThreadsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    const terminalDrawer =
      document.querySelector<CopilotKitThreadsDrawerElement>(
        COPILOTKIT_THREADS_DRAWER_TAG,
      );
    expect(terminalDrawer?.loading).toBe(false);
    expect(terminalDrawer?.licensed).toBe(false);
    expect(screen.getByTestId("threads-feature-authority").textContent).toBe(
      "status:unknown threads:false",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    dispose();
    vi.useRealTimers();
  }
});

test("a failed retry request becomes terminal after the bounded retry", async () => {
  vi.useFakeTimers();
  const { dispose, fetchMock } = setupDrawerTest(retryableRuntimeInfo());

  try {
    render(
      <CopilotKitProvider runtimeUrl="/api">
        <CopilotChatConfigurationProvider>
          <ThreadsFeatureProbe />
          <CopilotThreadsDrawer />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await flushPromiseUpdates();

    expect(fetchMock).toHaveBeenCalledOnce();
    const pendingDrawer =
      document.querySelector<CopilotKitThreadsDrawerElement>(
        COPILOTKIT_THREADS_DRAWER_TAG,
      );
    expect(pendingDrawer?.loading).toBe(true);
    expect(pendingDrawer?.licensed).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useThreadsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    const terminalDrawer =
      document.querySelector<CopilotKitThreadsDrawerElement>(
        COPILOTKIT_THREADS_DRAWER_TAG,
      );
    expect(terminalDrawer?.loading).toBe(false);
    expect(terminalDrawer?.licensed).toBe(false);
    expect(screen.getByTestId("threads-feature-authority").textContent).toBe(
      "status:unknown threads:false",
    );
  } finally {
    dispose();
    vi.useRealTimers();
  }
});
