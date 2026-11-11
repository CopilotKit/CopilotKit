import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import type {
  RuntimeInfo,
  ThreadEndpointRuntimeInfo,
} from "@copilotkit/shared";
import { COPILOTKIT_THREADS_DRAWER_TAG } from "@copilotkit/web-components/threads-drawer";
import type { CopilotKitThreadsDrawer as CopilotKitThreadsDrawerElement } from "@copilotkit/web-components/threads-drawer";
import { afterEach, expect, test, vi } from "vitest";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotThreadsDrawer } from "../CopilotThreadsDrawer";

/**
 * `/info` of a runtime without Intelligence: it reports no license status and
 * no entitlements, only which thread routes it serves.
 */
function runtimeInfoWithoutIntelligence(
  threadEndpoints: ThreadEndpointRuntimeInfo,
): RuntimeInfo {
  return {
    version: "2.0.0",
    agents: {},
    audioFileTranscriptionEnabled: false,
    mode: "sse",
    threadEndpoints,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Serve `/info`, and answer `GET /threads` with `threadsResponse`. */
function stubRuntime(info: RuntimeInfo, threadsResponse: () => Response) {
  const requestedPaths: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        "http://localhost",
      );
      requestedPaths.push(url.pathname);
      return url.pathname === "/api/threads"
        ? threadsResponse()
        : jsonResponse(info);
    }),
  );
  return { requestedPaths };
}

function renderDrawer() {
  render(
    <CopilotKitProvider runtimeUrl="/api">
      <CopilotChatConfigurationProvider>
        <CopilotThreadsDrawer />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );
}

/** The drawer body's visible state, read from the element's shadow root. */
function drawerState() {
  const drawer = document.querySelector<CopilotKitThreadsDrawerElement>(
    COPILOTKIT_THREADS_DRAWER_TAG,
  );
  const state = drawer?.shadowRoot?.querySelector(
    '[data-testid="drawer-error"], [data-testid="drawer-loading"], ' +
      '[data-testid="drawer-empty"], [data-testid="drawer-licensed"]',
  );
  return {
    testId: state?.getAttribute("data-testid") ?? null,
    text: state?.querySelector("p")?.textContent?.trim() ?? null,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("a runtime that refuses to list threads without a caller identity shows why", async () => {
  const { requestedPaths } = stubRuntime(
    runtimeInfoWithoutIntelligence({
      list: false,
      inspect: true,
      mutations: false,
      realtimeMetadata: false,
    }),
    () => jsonResponse({ error: "thread_access_not_configured" }, 403),
  );

  renderDrawer();

  await waitFor(() => {
    expect(drawerState()).toEqual({
      testId: "drawer-error",
      text: "Listing threads needs a caller identity. Set identifyUser on CopilotRuntime.",
    });
  });
  expect(requestedPaths).not.toContain("/api/threads");
});

test("a failed thread list load leaves the loading state", async () => {
  stubRuntime(
    runtimeInfoWithoutIntelligence({
      list: true,
      inspect: true,
      mutations: false,
      realtimeMetadata: false,
    }),
    () => jsonResponse({ error: "thread_access_not_configured" }, 403),
  );

  renderDrawer();

  await waitFor(() => {
    expect(drawerState()).toEqual({
      testId: "drawer-error",
      text: "Failed to fetch threads: 403",
    });
  });
});
