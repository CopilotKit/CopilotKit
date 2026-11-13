/**
 * Adapter-level regression test for the external-activity seed.
 *
 * The session is self-driving: given a `messageId`, it subscribes to the agent's
 * message store, finds that activity, and pushes its tool input/result to the
 * widget itself. But the store is authoritative only for activities that live in
 * it. A host can render an activity from an EXTERNAL message list (e.g.
 * CopilotChatView's `messages` prop) that is absent from `agent.messages`; the
 * subscription then finds nothing, so the adapter must feed the widget itself.
 *
 * The bug this guards (MCPAppsActivityRenderer.tsx): the content-forwarding
 * effect runs once at mount, BEFORE the asynchronous `import()` of the bridge
 * has set `sessionRef.current`, so it no-ops. With unchanged props it never
 * re-runs. Without an explicit post-bind seed, an external activity would never
 * receive its initial tool input/result. The adapter seeds the widget via
 * `session.syncContent(contentRef.current)` immediately after binding.
 *
 * Unlike the sibling *.e2e.test.tsx files, this one mocks the bridge package so
 * it can observe the adapter's wiring directly: the jsdom sandbox iframe (srcdoc)
 * never initializes, so a real bridge could not confirm delivery here anyway.
 */
import { render, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import React from "react";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { MockStepwiseAgent } from "../../../__tests__/utils/test-helpers";
import {
  MCPAppsActivityRenderer,
  MCPAppsActivityType,
} from "../../../components/MCPAppsActivityRenderer";
import type { MCPAppsActivityContent } from "../../../components/MCPAppsActivityRenderer";

// Capture the bindMcpApp options and the returned session's calls. Hoisted so
// the vi.mock factory (which is itself hoisted above imports) can reference them.
const { bindMcpAppSpy, sessionSpy } = vi.hoisted(() => {
  const session = {
    sendToolInput: vi.fn(),
    sendToolResult: vi.fn(),
    syncContent: vi.fn(),
    teardown: vi.fn(),
  };
  const bind = vi.fn((_opts: { messageId?: string }) => session);
  return { bindMcpAppSpy: bind, sessionSpy: session };
});

// Mock only the bridge entry. The adapter re-exports the activity surface from
// the separate `/activity` entry (kept real) and loads the bridge lazily via
// `import("@copilotkit/mcp-apps-renderer")` (intercepted here).
vi.mock("@copilotkit/mcp-apps-renderer", () => ({
  bindMcpApp: bindMcpAppSpy,
}));

const EXTERNAL_TOOL_INPUT = { city: "Paris", days: 3 };
const EXTERNAL_RESULT = {
  content: [{ type: "text", text: "Forecast: sunny" }],
  isError: false,
};

function externalActivityContent(): MCPAppsActivityContent {
  return {
    resourceUri: "ui://external-server/weather",
    serverHash: "external-hash",
    toolInput: EXTERNAL_TOOL_INPUT,
    result: EXTERNAL_RESULT,
  } as MCPAppsActivityContent;
}

/** Render the adapter directly, inside the provider that supplies the host. */
function renderAdapter(
  content: MCPAppsActivityContent,
  agent: MockStepwiseAgent,
) {
  const agentId = "external-agent";
  agent.agentId = agentId;
  return render(
    <CopilotKitProvider agents__unsafe_dev_only={{ [agentId]: agent }}>
      <CopilotChatConfigurationProvider agentId={agentId} threadId="t1">
        <MCPAppsActivityRenderer
          activityType={MCPAppsActivityType}
          content={content}
          message={{ id: "external-activity-1" }}
          agent={agent}
        />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );
}

describe("MCPAppsActivityRenderer external-activity seed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the activity messageId to the bridge for self-subscription", async () => {
    const agent = new MockStepwiseAgent();
    renderAdapter(externalActivityContent(), agent);

    await waitFor(() => expect(bindMcpAppSpy).toHaveBeenCalledTimes(1));
    const opts = bindMcpAppSpy.mock.calls[0][0];
    expect(opts.messageId).toBe("external-activity-1");
  });

  it("seeds the widget with the initial tool input/result right after binding, even when props never change", async () => {
    // The agent's store is empty: this activity comes from an external message
    // list, so the session's subscription would find nothing. Props are set once
    // and never updated after mount, so the content-forwarding effect only ever
    // fires at mount, before the async import resolves sessionRef.current.
    const agent = new MockStepwiseAgent();
    expect(agent.messages).toHaveLength(0);

    renderAdapter(externalActivityContent(), agent);

    // The sole delivery path under these conditions is the post-bind seed. If it
    // is removed, syncContent is never called (mount effect no-ops, then never
    // re-runs), and this assertion fails.
    await waitFor(() => expect(sessionSpy.syncContent).toHaveBeenCalled());
    expect(sessionSpy.syncContent).toHaveBeenCalledWith(
      expect.objectContaining({
        toolInput: EXTERNAL_TOOL_INPUT,
        result: EXTERNAL_RESULT,
      }),
    );
  });
});
