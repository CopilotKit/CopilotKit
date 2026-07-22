import React from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { COPILOTKIT_THREADS_DRAWER_TAG } from "@copilotkit/web-components/threads-drawer";
import type { CopilotKitThreadsDrawer as CopilotKitThreadsDrawerElement } from "@copilotkit/web-components/threads-drawer";
import type { UseThreadsInput } from "../../../hooks/use-threads";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotThreadsDrawer } from "../CopilotThreadsDrawer";

const useThreadsMock = vi.fn();

vi.mock("../../../hooks/use-threads", () => ({
  useThreads: (input: UseThreadsInput) => useThreadsMock(input),
}));

const originalFetch = globalThis.fetch;

beforeEach(() => {
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
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("managed entitlements enable the drawer without a license token", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      version: "1.0.0",
      agents: {},
      audioFileTranscriptionEnabled: false,
      mode: "intelligence",
      licenseStatus: "valid",
      runtimeEntitlements: {
        status: "ready",
        entitlement: {
          active: true,
          source: "managed",
          plan: "pro",
          features: ["threads"],
        },
      },
    }),
  }) as typeof globalThis.fetch;

  render(
    <CopilotKitProvider runtimeUrl="/api">
      <CopilotChatConfigurationProvider>
        <CopilotThreadsDrawer />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );

  await waitFor(() =>
    expect(useThreadsMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    ),
  );

  const drawer = document.querySelector(
    COPILOTKIT_THREADS_DRAWER_TAG,
  ) as CopilotKitThreadsDrawerElement | null;
  expect(drawer?.licensed).toBe(true);
});
