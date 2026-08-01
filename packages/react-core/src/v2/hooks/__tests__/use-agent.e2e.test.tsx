import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, it, expect } from "vitest";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { Observable } from "rxjs";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runStartedEvent,
  runFinishedEvent,
  textChunkEvent,
  testId,
} from "../../__tests__/utils/test-helpers";
import { useAgent } from "../use-agent";
import {
  CopilotKitProvider,
  useCopilotKit,
} from "../../providers/CopilotKitProvider";
import { CopilotChat } from "../../components/chat/CopilotChat";
import { CopilotChatConfigurationProvider } from "../../providers/CopilotChatConfigurationProvider";

/**
 * Mock agent that captures RunAgentInput to verify state is passed correctly
 */
class StateCapturingMockAgent extends MockStepwiseAgent {
  // Shared via a container so the clone and original both see the same value
  private _capture: { lastRunInput?: RunAgentInput } = {};

  get lastRunInput(): RunAgentInput | undefined {
    return this._capture.lastRunInput;
  }

  clone(): this {
    const cloned = super.clone();
    (cloned as unknown as StateCapturingMockAgent)._capture = this._capture;
    return cloned;
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    this._capture.lastRunInput = input;
    return super.run(input);
  }
}

describe("useAgent e2e", () => {
  describe("setState passes state to agent run", () => {
    it("agent receives state set via setState when runAgent is called", async () => {
      const agent = new StateCapturingMockAgent();

      /**
       * Test component that:
       * 1. Gets agent via useAgent()
       * 2. Gets copilotkit via useCopilotKit()
       * 3. Sets state on agent and calls runAgent
       */
      function StateTestComponent() {
        const { agent: hookAgent } = useAgent();
        const { copilotkit } = useCopilotKit();

        const handleSetStateAndRun = async () => {
          hookAgent.setState({ testKey: "testValue", counter: 42 });
          await copilotkit.runAgent({ agent: hookAgent });
        };

        return (
          <button data-testid="trigger-btn" onClick={handleSetStateAndRun}>
            Set State and Run
          </button>
        );
      }

      renderWithCopilotKit({
        agent,
        children: <StateTestComponent />,
      });

      // Click the button to set state and trigger runAgent
      const triggerBtn = await screen.findByTestId("trigger-btn");
      fireEvent.click(triggerBtn);

      // Wait for the agent's run method to be called
      await waitFor(() => {
        expect(agent.lastRunInput).toBeDefined();
      });

      // Complete the agent run
      agent.emit(runStartedEvent());
      agent.emit(runFinishedEvent());
      agent.complete();

      // Verify the state was passed to the agent
      expect(agent.lastRunInput?.state).toEqual({
        testKey: "testValue",
        counter: 42,
      });
    });
  });

  describe("addMessage + runAgent displays in CopilotChat", () => {
    it("messages added via useAgent show up in CopilotChat", async () => {
      const agent = new MockStepwiseAgent();

      /**
       * Test component that:
       * 1. Gets agent via useAgent()
       * 2. Gets copilotkit via useCopilotKit()
       * 3. Adds a user message and calls runAgent
       */
      function MessageTestComponent() {
        const { agent: hookAgent } = useAgent();
        const { copilotkit } = useCopilotKit();

        const handleAddMessageAndRun = async () => {
          hookAgent.addMessage({
            id: testId("user-msg"),
            role: "user",
            content: "Hello from useAgent!",
          });
          await copilotkit.runAgent({ agent: hookAgent });
        };

        return (
          <div>
            <button data-testid="send-btn" onClick={handleAddMessageAndRun}>
              Send Message
            </button>
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </div>
        );
      }

      renderWithCopilotKit({
        agent,
        children: <MessageTestComponent />,
      });

      // Click the button to add message and trigger runAgent
      const sendBtn = await screen.findByTestId("send-btn");
      fireEvent.click(sendBtn);

      // User message should appear in the chat
      await waitFor(() => {
        expect(screen.getByText("Hello from useAgent!")).toBeDefined();
      });

      // Simulate agent response
      const responseId = testId("assistant-msg");
      agent.emit(runStartedEvent());
      agent.emit(textChunkEvent(responseId, "Hello! I received your message."));
      agent.emit(runFinishedEvent());
      agent.complete();

      // Assistant response should appear in the chat
      await waitFor(() => {
        expect(
          screen.getByText("Hello! I received your message."),
        ).toBeDefined();
      });
    });
  });

  it("routes ephemeral operations to the current agent and thread", async () => {
    const agent = new MockStepwiseAgent();

    function EphemeralTestComponent() {
      const {
        addEphemeralMessage,
        removeEphemeralMessage,
        clearEphemeralMessages,
        ephemeralMessages,
      } = useAgent();

      return (
        <div>
          <button
            data-testid="add-ephemeral"
            onClick={() =>
              addEphemeralMessage({
                id: "frontend-event",
                content: "Frontend event",
              })
            }
          >
            Add
          </button>
          <button
            data-testid="remove-ephemeral"
            onClick={() => removeEphemeralMessage("frontend-event")}
          >
            Remove
          </button>
          <button
            data-testid="clear-ephemeral"
            onClick={() => clearEphemeralMessages()}
          >
            Clear
          </button>
          <output data-testid="ephemeral-values">
            {ephemeralMessages.map(
              (message) => `${message.id}:${message.content}`,
            )}
          </output>
        </div>
      );
    }

    renderWithCopilotKit({
      agent,
      threadId: "thread-a",
      children: <EphemeralTestComponent />,
    });

    fireEvent.click(await screen.findByTestId("add-ephemeral"));
    await waitFor(() => {
      expect(screen.getByTestId("ephemeral-values").textContent).toContain(
        "frontend-event:Frontend event",
      );
    });

    fireEvent.click(screen.getByTestId("remove-ephemeral"));
    await waitFor(() => {
      expect(screen.getByTestId("ephemeral-values").textContent).toBe("");
    });

    fireEvent.click(screen.getByTestId("add-ephemeral"));
    fireEvent.click(screen.getByTestId("clear-ephemeral"));
    await waitFor(() => {
      expect(screen.getByTestId("ephemeral-values").textContent).toBe("");
    });
  });

  it("keeps new-thread ephemeral IDs valid while the previous messages are still present", async () => {
    const agent = new MockStepwiseAgent();
    let currentAdd:
      | ((message: { id: string; content: string }) => boolean)
      | undefined;
    let seeded = false;

    function Harness() {
      const {
        agent: hookAgent,
        addEphemeralMessage,
        ephemeralMessages,
      } = useAgent();
      const { copilotkit } = useCopilotKit();
      currentAdd = addEphemeralMessage;

      useEffect(() => {
        if (seeded) return;
        seeded = true;
        hookAgent.addMessage({
          id: "reused-card-id",
          role: "user",
          content: "thread A history",
        });
        copilotkit.addEphemeralMessage("default", "thread-b", {
          id: "reused-card-id",
          content: "thread B card",
        });
      }, [copilotkit, hookAgent]);

      return (
        <output data-testid="transition-ephemeral-values">
          {ephemeralMessages.map(
            (message) => `${message.id}:${message.content}`,
          )}
        </output>
      );
    }

    const { rerender } = render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChatConfigurationProvider agentId="default" threadId="thread-a">
          <Harness />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    rerender(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChatConfigurationProvider agentId="default" threadId="thread-b">
          <Harness />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      expect(currentAdd?.({ id: "reused-card-id", content: "updated" })).toBe(
        true,
      );
      expect(
        screen.getByTestId("transition-ephemeral-values").textContent,
      ).toContain("reused-card-id");
    });
  });

  it("clears non-explicit history before returning to an explicit thread", async () => {
    const agent = new MockStepwiseAgent();
    let switchScope:
      | ((threadId: string, hasExplicitThreadId: boolean) => void)
      | undefined;

    function ScopeControls() {
      const {
        agent: hookAgent,
        addEphemeralMessage,
        ephemeralMessages,
      } = useAgent();
      const [lastAddResult, setLastAddResult] = React.useState<boolean | null>(
        null,
      );

      return (
        <>
          <button
            data-testid="switch-to-non-explicit-b"
            onClick={() => switchScope?.("thread-b", false)}
          >
            Switch to B
          </button>
          <button
            data-testid="switch-to-explicit-a"
            onClick={() => switchScope?.("thread-a", true)}
          >
            Switch to A
          </button>
          <button
            data-testid="add-persisted-b-message"
            onClick={() =>
              hookAgent.addMessage({
                id: "shared-message-id",
                role: "user",
                content: "thread B history",
              })
            }
          >
            Add B history
          </button>
          <button
            data-testid="add-ephemeral-a-message"
            onClick={() =>
              setLastAddResult(
                addEphemeralMessage({
                  id: "shared-message-id",
                  content: "thread A card",
                }),
              )
            }
          >
            Add A card
          </button>
          <output data-testid="persisted-message-ids">
            {hookAgent.messages.map((message) => message.id).join(",")}
          </output>
          <output data-testid="ephemeral-message-values">
            {ephemeralMessages
              .map((message) => `${message.id}:${message.content}`)
              .join(",")}
          </output>
          <output data-testid="last-ephemeral-add-result">
            {lastAddResult === null ? "" : String(lastAddResult)}
          </output>
        </>
      );
    }

    function Harness() {
      const [scope, setScope] = React.useState({
        threadId: "thread-a",
        hasExplicitThreadId: true,
      });
      switchScope = (threadId, hasExplicitThreadId) =>
        setScope({ threadId, hasExplicitThreadId });

      return (
        <CopilotChatConfigurationProvider
          agentId="default"
          threadId={scope.threadId}
          hasExplicitThreadId={scope.hasExplicitThreadId}
        >
          <ScopeControls />
          <div style={{ height: 400 }}>
            <CopilotChat welcomeScreen={false} />
          </div>
        </CopilotChatConfigurationProvider>
      );
    }

    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <Harness />
      </CopilotKitProvider>,
    );

    fireEvent.click(await screen.findByTestId("switch-to-non-explicit-b"));
    await waitFor(() => expect(agent.threadId).toBe("thread-b"));

    fireEvent.click(screen.getByTestId("add-persisted-b-message"));
    await waitFor(() => {
      expect(screen.getByTestId("persisted-message-ids").textContent).toBe(
        "shared-message-id",
      );
    });

    fireEvent.click(screen.getByTestId("switch-to-explicit-a"));
    await waitFor(() => expect(agent.threadId).toBe("thread-a"));
    await waitFor(() => {
      expect(screen.getByTestId("persisted-message-ids").textContent).toBe("");
    });

    fireEvent.click(screen.getByTestId("add-ephemeral-a-message"));
    await waitFor(() => {
      expect(screen.getByTestId("last-ephemeral-add-result").textContent).toBe(
        "true",
      );
      expect(
        screen.getByTestId("ephemeral-message-values").textContent,
      ).toContain("shared-message-id:thread A card");
    });
  });

  it("reconciles persisted collisions when message updates are disabled", async () => {
    const agent = new MockStepwiseAgent();

    function Harness() {
      const { agent: hookAgent, ephemeralMessages } = useAgent({
        updates: [],
      });
      const { copilotkit } = useCopilotKit();

      React.useEffect(() => {
        copilotkit.addEphemeralMessage("default", "test-thread", {
          id: "collision-card",
          content: "client-only",
        });
        hookAgent.addMessage({
          id: "collision-card",
          role: "user",
          content: "persisted",
        });
      }, [copilotkit, hookAgent]);

      return (
        <output data-testid="reconciled-ephemeral-values">
          {ephemeralMessages.map((message) => message.id).join(",")}
        </output>
      );
    }

    renderWithCopilotKit({ agent, children: <Harness /> });
    await waitFor(() => {
      expect(
        screen.getByTestId("reconciled-ephemeral-values").textContent,
      ).toBe("");
    });
  });

  it("uses a private thread argument over the surrounding chat thread", async () => {
    const runtimeAgent = new MockStepwiseAgent();

    function PrivateThreadComponent() {
      const { addEphemeralMessage, isReady } = useAgent({
        agentId: "private",
        runtimeAgentId: "runtime",
        threadId: "private-thread",
      });
      const { copilotkit } = useCopilotKit();

      return (
        <>
          <output data-testid="private-agent-ready">{String(isReady)}</output>
          <button
            data-testid="add-private-thread-card"
            onClick={() =>
              addEphemeralMessage({
                id: "private-thread-card",
                content: "private thread",
              })
            }
          >
            Add private thread card
          </button>
          <output data-testid="private-thread-values">
            {copilotkit
              .getEphemeralMessages("private", "private-thread")
              .map((message) => message.id)}
          </output>
          <output data-testid="outer-thread-values">
            {copilotkit
              .getEphemeralMessages("private", "outer-thread")
              .map((message) => message.id)}
          </output>
        </>
      );
    }

    renderWithCopilotKit({
      agents: { runtime: runtimeAgent },
      threadId: "outer-thread",
      children: <PrivateThreadComponent />,
    });

    await waitFor(() => {
      expect(screen.getByTestId("private-agent-ready").textContent).toBe(
        "true",
      );
    });
    fireEvent.click(screen.getByTestId("add-private-thread-card"));
    await waitFor(() => {
      expect(screen.getByTestId("private-thread-values").textContent).toBe(
        "private-thread-card",
      );
      expect(screen.getByTestId("outer-thread-values").textContent).toBe("");
    });
  });

  it("rejects a deferred callback captured before an explicit thread switch", async () => {
    const agent = new MockStepwiseAgent();
    let staleAdd:
      | ((message: { id: string; content: string }) => boolean)
      | null = null;

    function Harness() {
      const { addEphemeralMessage } = useAgent();
      React.useEffect(() => {
        staleAdd ??= addEphemeralMessage;
      }, [addEphemeralMessage]);
      return null;
    }

    const { rerender } = render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChatConfigurationProvider agentId="default" threadId="thread-a">
          <Harness />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await waitFor(() => expect(staleAdd).not.toBeNull());
    rerender(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChatConfigurationProvider agentId="default" threadId="thread-b">
          <Harness />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      expect(staleAdd?.({ id: "stale-thread-card", content: "stale" })).toBe(
        false,
      );
    });
  });

  it("rejects a deferred callback captured before an explicit agent switch", async () => {
    const firstAgent = new MockStepwiseAgent();
    const secondAgent = new MockStepwiseAgent();
    let staleAdd:
      | ((message: { id: string; content: string }) => boolean)
      | null = null;

    function Harness() {
      const { addEphemeralMessage } = useAgent();
      React.useEffect(() => {
        staleAdd ??= addEphemeralMessage;
      }, [addEphemeralMessage]);
      return null;
    }

    const { rerender } = render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ first: firstAgent, second: secondAgent }}
      >
        <CopilotChatConfigurationProvider agentId="first" threadId="thread-a">
          <Harness />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await waitFor(() => expect(staleAdd).not.toBeNull());
    rerender(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ first: firstAgent, second: secondAgent }}
      >
        <CopilotChatConfigurationProvider agentId="second" threadId="thread-a">
          <Harness />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      expect(staleAdd?.({ id: "stale-agent-card", content: "stale" })).toBe(
        false,
      );
    });
  });
});
