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
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotThreadsDrawer } from "../CopilotThreadsDrawer";

const useThreadsMock = vi.fn<(input: UseThreadsInput) => UseThreadsResult>();

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

test("a retryable entitlement result stays pending until the mounted drawer recovers", async () => {
  vi.useFakeTimers();
  const retryableRuntimeEntitlements: RuntimeEntitlementResponse = {
    status: "unavailable",
    error: {
      code: "runtime_entitlements_unavailable",
      message: "Runtime entitlement lookup failed",
      retryable: true,
    },
  };
  const { dispose, fetchMock } = setupDrawerTest(
    {
      ...managedRuntimeInfo(true),
      licenseStatus: "unknown",
      runtimeEntitlements: retryableRuntimeEntitlements,
    },
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
