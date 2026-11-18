/**
 * Vue counterpart of react-core's `MCPAppsActivityRendererSeed.test.tsx`.
 *
 * The session is self-driving: given a `messageId`, it subscribes to the agent's
 * message store and pushes tool input/result to the widget itself. That store is
 * authoritative only for activities that live in it - a host can render an
 * activity from an EXTERNAL messages list (absent from `agent.messages`), whose
 * props may never change after mount. For those, the adapter must seed the
 * widget by calling `session.syncContent(props.content)` immediately after
 * binding, otherwise the widget would never receive its initial content.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import type { AbstractAgent } from "@ag-ui/client";

// Capture the bindMcpApp options and the returned session's calls. Hoisted so
// the vi.mock factory (which is itself hoisted above imports) can reference them.
const { bindMcpAppSpy, sessionSpy } = vi.hoisted(() => {
  const session = {
    sendToolInput: vi.fn(),
    sendToolResult: vi.fn(),
    syncContent: vi.fn(),
    teardown: vi.fn(),
  };
  const bind = vi.fn(() => session);
  return { bindMcpAppSpy: bind, sessionSpy: session };
});

// Only the bridge-carrying root entry is mocked; the bridge-free `/activity`
// entry (activity type + content schema) stays real, as in the React test.
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
import type { MCPAppsActivityContent } from "../MCPAppsActivityRenderer";

function createAgentMock(): AbstractAgent {
  return {
    threadId: "seed-thread",
    isRunning: false,
    // The activity under test is NOT in the store: this is the external
    // messages-list case the seed exists for.
    messages: [],
    runAgent: vi.fn().mockResolvedValue({ result: { contents: [] } }),
    addMessage: vi.fn(),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
  } as unknown as AbstractAgent;
}

const content: MCPAppsActivityContent = {
  resourceUri: "ui://server/external",
  serverHash: "hash-external",
  toolInput: { city: "Paris" },
  result: { content: [{ type: "text", text: "Forecast" }], isError: false },
} as MCPAppsActivityContent;

function mountRenderer() {
  return mount(MCPAppsActivityRenderer, {
    props: {
      activityType: MCPAppsActivityType,
      content,
      message: {
        id: "external-activity-1",
        role: "activity",
        content: {},
        activityType: MCPAppsActivityType,
      },
      agent: createAgentMock(),
    },
  });
}

describe("MCPAppsActivityRenderer external-activity seed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the activity messageId to the bridge for self-subscription", async () => {
    mountRenderer();

    await vi.waitFor(() => expect(bindMcpAppSpy).toHaveBeenCalledTimes(1));
    const opts = bindMcpAppSpy.mock.calls[0]![0];
    expect(opts.messageId).toBe("external-activity-1");
  });

  it("seeds the widget with the initial tool input/result right after binding, even when props never change", async () => {
    mountRenderer();

    // The content watcher does not re-run for unchanged props, so without the
    // explicit seed the widget would never receive this initial content.
    await vi.waitFor(() => expect(sessionSpy.syncContent).toHaveBeenCalled());
    expect(sessionSpy.syncContent).toHaveBeenCalledWith(
      expect.objectContaining({
        toolInput: { city: "Paris" },
        resourceUri: "ui://server/external",
      }),
    );
  });
});
