import React, { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockStepwiseAgent } from "../../../__tests__/utils/test-helpers";
import { useCopilotKit } from "../../../context";
import type { CopilotKitCoreReact } from "../../../lib/react-core";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChat } from "../CopilotChat";

function CaptureCore({
  onCore,
}: {
  onCore: (core: CopilotKitCoreReact) => void;
}) {
  const { copilotkit } = useCopilotKit();
  React.useLayoutEffect(() => {
    onCore(copilotkit);
  }, [copilotkit, onCore]);
  return null;
}

function ChatPair() {
  return (
    <>
      <CopilotChatConfigurationProvider
        agentId="agent-a"
        threadId="thread-a"
        hasExplicitThreadId={false}
      >
        <CopilotChat welcomeScreen={false} />
      </CopilotChatConfigurationProvider>
      <CopilotChatConfigurationProvider
        agentId="agent-b"
        threadId="thread-b"
        hasExplicitThreadId={false}
      >
        <CopilotChat welcomeScreen={false} input={{ autoFocus: true }} />
      </CopilotChatConfigurationProvider>
    </>
  );
}

describe("CopilotChat Learning thread selection", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("retains the autofocused chat through StrictMode effect replay", () => {
    let core: CopilotKitCoreReact | undefined;
    render(
      <StrictMode>
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            "agent-a": new MockStepwiseAgent(),
            "agent-b": new MockStepwiseAgent(),
          }}
          learning={false}
        >
          <CaptureCore onCore={(value) => (core = value)} />
          <ChatPair />
        </CopilotKitProvider>
      </StrictMode>,
    );

    expect(document.activeElement).toBe(screen.getAllByRole("textbox")[1]);
    expect(core?.ɵlearningThreads.getThreadId()).toBe("thread-b");
  });

  it.each([false, true])(
    "retains focus through delayed readiness (other chat ready: %s)",
    async (otherChatReady) => {
      let core: CopilotKitCoreReact | undefined;
      let resolveInfo!: (response: Response) => void;
      const info = new Promise<Response>((resolve) => {
        resolveInfo = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(() => info),
      );
      const agentA = new MockStepwiseAgent();
      const agentB = new MockStepwiseAgent();

      render(
        <CopilotKitProvider
          runtimeUrl="http://localhost:59999/api"
          agents__unsafe_dev_only={
            otherChatReady ? { "agent-a": agentA } : undefined
          }
          learning={false}
        >
          <CaptureCore onCore={(value) => (core = value)} />
          <ChatPair />
        </CopilotKitProvider>,
      );

      const focusedInput = screen.getAllByRole("textbox")[1];
      expect(document.activeElement).toBe(focusedInput);
      // An unavailable selected chat must not fall back to another ready chat.
      expect(core?.ɵlearningThreads.getThreadId()).toBeUndefined();
      if (!core) throw new Error("CopilotKit core did not mount");
      const mountedCore = core;

      await act(async () => {
        if (!otherChatReady) {
          mountedCore.addAgent__unsafe_dev_only({
            id: "agent-a",
            agent: agentA,
          });
        }
        mountedCore.addAgent__unsafe_dev_only({ id: "agent-b", agent: agentB });
        resolveInfo(
          new Response(
            JSON.stringify({
              version: "1.0.0",
              audioFileTranscriptionEnabled: false,
              agents: {},
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      });

      // Readiness changes must preserve focus without requiring a new event.
      expect(document.activeElement).toBe(focusedInput);
      expect(mountedCore.ɵlearningThreads.getThreadId()).toBe("thread-b");
    },
  );
});
