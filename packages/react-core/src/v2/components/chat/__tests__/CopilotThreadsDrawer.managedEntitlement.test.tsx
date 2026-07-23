import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { RuntimeInfo } from "@copilotkit/shared";
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
 * Set up an active managed entitlement with the requested thread grant and an
 * inert thread store for the provider-to-drawer integration path.
 */
function setupManagedEntitlementDrawerTest(threadsEnabled: boolean) {
  const runtimeInfo = {
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
  } satisfies RuntimeInfo;
  const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(JSON.stringify(runtimeInfo), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
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
    dispose() {
      cleanup();
      vi.unstubAllGlobals();
      useThreadsMock.mockReset();
    },
  };
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
