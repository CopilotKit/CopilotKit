/**
 * A content rejection is RECOVERABLE: the session reports it through
 * `onContentError` and, once valid content resumes, calls it again with `null`.
 * The adapter must clear the message then - otherwise the widget starts working
 * again while the host still shows a stale error until the next bind.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import type { AbstractAgent } from "@ag-ui/client";

// Capture the hooks the adapter hands to the session, so the test can drive the
// recoverable/fatal channels directly.
const { bindMcpAppSpy, sessionSpy } = vi.hoisted(() => {
  const session = {
    sendToolInput: vi.fn(),
    sendToolResult: vi.fn(),
    syncContent: vi.fn(),
    teardown: vi.fn(),
  };
  return { bindMcpAppSpy: vi.fn(() => session), sessionSpy: session };
});

vi.mock("@copilotkit/mcp-apps-renderer", () => ({
  bindMcpApp: bindMcpAppSpy,
}));

vi.mock("../../providers/useCopilotKit", () => ({
  useCopilotKit: () => ({
    copilotkit: { value: { runAgent: vi.fn() } },
  }),
}));

import {
  MCPAppsActivityRenderer,
  MCPAppsActivityType,
} from "../MCPAppsActivityRenderer";

function createAgentMock(): AbstractAgent {
  return {
    threadId: "content-error-thread",
    isRunning: false,
    messages: [],
    runAgent: vi.fn().mockResolvedValue({ result: { contents: [] } }),
    addMessage: vi.fn(),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
  } as unknown as AbstractAgent;
}

function mountRenderer() {
  return mount(MCPAppsActivityRenderer, {
    props: {
      activityType: MCPAppsActivityType,
      content: {
        resourceUri: "ui://server/app",
        serverHash: "hash",
        result: { content: [] },
      },
      message: {
        id: "activity-1",
        role: "activity",
        content: {},
        activityType: MCPAppsActivityType,
      },
      agent: createAgentMock(),
    },
  });
}

/** The hooks object passed to the most recent bindMcpApp call. */
async function capturedHooks() {
  await vi.waitFor(() => expect(bindMcpAppSpy).toHaveBeenCalled());
  const options = bindMcpAppSpy.mock.calls.at(-1)![0] as {
    hooks?: {
      onContentError?: (err: Error | null) => void;
      onError?: (err: Error) => void;
    };
  };
  return options.hooks!;
}

describe("MCPAppsActivityRenderer content error recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a rejected-content error and clears it when valid content resumes", async () => {
    const wrapper = mountRenderer();
    const hooks = await capturedHooks();

    // valid -> nothing shown
    expect(wrapper.text()).not.toContain("Error:");

    // invalid -> the rejection is visible
    hooks.onContentError!(new Error("content does not match the schema"));
    await nextTick();
    expect(wrapper.text()).toContain("content does not match the schema");

    // valid again -> the message disappears
    hooks.onContentError!(null);
    await nextTick();
    expect(wrapper.text()).not.toContain("content does not match the schema");
    expect(wrapper.text()).not.toContain("Error:");
  });

  it("keeps a fatal session error on screen", async () => {
    const wrapper = mountRenderer();
    const hooks = await capturedHooks();

    hooks.onError!(new Error("No resource content in response"));
    await nextTick();
    expect(wrapper.text()).toContain("No resource content in response");

    // Clearing the recoverable channel must not clear a fatal error.
    hooks.onContentError!(null);
    await nextTick();
    expect(wrapper.text()).toContain("No resource content in response");
  });
});

// Referenced so the session stub is not tree-shaken out of the mock factory.
void sessionSpy;
