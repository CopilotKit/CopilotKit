import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CopilotKit } from "../../components/copilot-provider/copilotkit";
import type { CopilotKitProps } from "../../components/copilot-provider/copilotkit-props";
import { useCopilotChatInternal } from "../use-copilot-chat_internal";
import { useAgent } from "../../v2";

/**
 * Issue #4943: the legacy CopilotPopup / useCopilotChatInternal path must reuse
 * an app-supplied threadId for connect, run, and reload. If the resolved
 * threadId never lands on the agent, ProxiedCopilotRuntimeAgent ships its own
 * auto-minted UUID to /agent/connect and the existing thread never hydrates.
 *
 * These tests exercise the REAL v2 useAgent through the legacy hook — the
 * pre-existing use-copilot-chat-internal-connect suite mocks useAgent wholesale
 * and therefore cannot observe threadId propagation at all.
 */

// `agents__unsafe_dev_only` isn't declared on v1 CopilotKitProps but is
// forwarded via spread to the v2 provider underneath.
type V1Props = CopilotKitProps & {
  agents__unsafe_dev_only?: Record<string, unknown>;
};
const CopilotKitAny = CopilotKit as unknown as React.FC<V1Props>;

describe("legacy useCopilotChatInternal → agent.threadId (#4943)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  /**
   * Drives the legacy chat hook (the surface CopilotPopup renders through) and
   * reports the agent instance that hook is operating on.
   */
  function LegacyChatProbe() {
    useCopilotChatInternal();
    const { agent } = useAgent({ agentId: "default" });
    return <div data-testid="threadId">{agent.threadId ?? ""}</div>;
  }

  it("adopts an explicit threadId supplied to <CopilotKit>", () => {
    render(
      <CopilotKitAny publicApiKey="test-key" threadId="cookie-backed-thread">
        <LegacyChatProbe />
      </CopilotKitAny>,
    );

    expect(screen.getByTestId("threadId").textContent).toBe(
      "cookie-backed-thread",
    );
  });

  it("keeps the agent's own threadId when the app supplies none", () => {
    // No explicit threadId: the ThreadsProvider mints a non-explicit
    // placeholder. Adopting it would make /connect ask the backend for a
    // thread it never created.
    render(
      <CopilotKitAny publicApiKey="test-key">
        <LegacyChatProbe />
      </CopilotKitAny>,
    );

    const threadId = screen.getByTestId("threadId").textContent;
    expect(threadId).toBeTruthy();
    expect(threadId).not.toBe("mock-thread-id");
  });
});
