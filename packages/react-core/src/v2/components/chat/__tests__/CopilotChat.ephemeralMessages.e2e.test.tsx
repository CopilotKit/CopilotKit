import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RunAgentInput } from "@ag-ui/client";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runFinishedEvent,
  runStartedEvent,
} from "../../../__tests__/utils/test-helpers";
import { useAgent } from "../../../hooks/use-agent";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { useCopilotKit } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotChat } from "../CopilotChat";

class CapturingAgent extends MockStepwiseAgent {
  lastRunInput?: RunAgentInput;

  run(input: RunAgentInput) {
    this.lastRunInput = input;
    return super.run(input);
  }
}

function EphemeralCard({
  message,
}: {
  message: { id: string; content: unknown };
}) {
  return (
    <div data-testid={`ephemeral-card-${message.id}`}>
      {String(message.content)}
    </div>
  );
}

const ephemeralRenderer = {
  render: null,
  renderEphemeral: EphemeralCard,
};

describe("CopilotChat ephemeral messages", () => {
  it("keeps a frontend event card out of the next agent run", async () => {
    const agent = new CapturingAgent();

    function Harness() {
      const { addEphemeralMessage, agent: hookAgent } = useAgent();
      const { copilotkit } = useCopilotKit();

      return (
        <>
          <button
            data-testid="add-card"
            onClick={() =>
              addEphemeralMessage({
                id: "frontend-event",
                content: "Frontend event card",
              })
            }
          >
            Add card
          </button>
          <button
            data-testid="run-agent"
            onClick={() => {
              hookAgent.addMessage({
                id: "ephemeral-card-lookalike",
                role: "user",
                content: "Persisted lookalike",
              });
              void copilotkit.runAgent({ agent: hookAgent });
            }}
          >
            Run agent
          </button>
          <div style={{ height: 400 }}>
            <CopilotChat welcomeScreen={false} />
          </div>
        </>
      );
    }

    renderWithCopilotKit({
      agent,
      renderCustomMessages: [ephemeralRenderer],
      children: <Harness />,
    });

    fireEvent.click(await screen.findByTestId("add-card"));
    expect(
      (await screen.findByTestId("ephemeral-card-frontend-event")).textContent,
    ).toContain("Frontend event card");

    fireEvent.click(screen.getByTestId("run-agent"));
    await waitFor(() => expect(agent.lastRunInput).toBeDefined());

    expect(agent.messages.map((message) => message.id)).toEqual([
      "ephemeral-card-lookalike",
    ]);
    expect(agent.lastRunInput?.messages.map((message) => message.id)).toEqual([
      "ephemeral-card-lookalike",
    ]);
    expect(
      screen.getByTestId("ephemeral-card-frontend-event").textContent,
    ).toContain("Frontend event card");

    agent.emit(runStartedEvent());
    agent.emit(runFinishedEvent());
    agent.complete();
  });

  it("keeps the welcome screen when an ephemeral entry has no renderer", async () => {
    const agent = new CapturingAgent();

    function UnrenderedControls() {
      const { addEphemeralMessage } = useAgent();
      return (
        <>
          <button
            data-testid="add-unrendered-card"
            onClick={() =>
              addEphemeralMessage({
                id: "unrendered-card",
                content: "No renderer",
              })
            }
          >
            Add unrendered card
          </button>
        </>
      );
    }

    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChatConfigurationProvider
          agentId="default"
          threadId="thread-a"
          hasExplicitThreadId={false}
        >
          <UnrenderedControls />
          <div style={{ height: 400 }}>
            <CopilotChat />
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    expect(screen.getByText("How can I help you today?")).toBeDefined();
    fireEvent.click(await screen.findByTestId("add-unrendered-card"));
    await waitFor(() => {
      expect(screen.getByText("How can I help you today?")).toBeDefined();
      expect(screen.queryByTestId("ephemeral-card-unrendered-card")).toBeNull();
    });
  });

  it("uses CopilotChat's resolved agent and thread over an outer provider scope", async () => {
    const outerAgent = new CapturingAgent();
    const resolvedAgent = new CapturingAgent();

    function ResolvedScopeView({
      ephemeralMessages = [],
    }: {
      ephemeralMessages?: ReadonlyArray<{ id: string; content: unknown }>;
    }) {
      const { addEphemeralMessage } = useAgent();
      return (
        <>
          <button
            data-testid="add-resolved-scope-card"
            onClick={() =>
              addEphemeralMessage({
                id: "resolved-scope-card",
                content: "resolved scope",
              })
            }
          >
            Add resolved scope card
          </button>
          <output data-testid="resolved-scope-cards">
            {ephemeralMessages.map((message) => message.id).join(",")}
          </output>
        </>
      );
    }

    render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ outer: outerAgent, resolved: resolvedAgent }}
      >
        <CopilotChatConfigurationProvider
          agentId="outer"
          threadId="outer-thread"
        >
          <CopilotChat
            agentId="resolved"
            threadId="resolved-thread"
            chatView={ResolvedScopeView as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    fireEvent.click(await screen.findByTestId("add-resolved-scope-card"));
    await waitFor(() => {
      expect(screen.getByTestId("resolved-scope-cards").textContent).toBe(
        "resolved-scope-card",
      );
    });
    expect(
      resolvedAgent.messages.some(
        (message) => message.id === "resolved-scope-card",
      ),
    ).toBe(false);
    expect(outerAgent.messages).toEqual([]);
  });

  it("renders the core-composed transcript in persisted-then-ephemeral order", async () => {
    const agent = new CapturingAgent();
    agent.addMessage({
      id: "persisted-message",
      role: "user",
      content: "Persisted message",
    });

    function Harness() {
      const { addEphemeralMessage, agent: hookAgent } = useAgent();
      React.useEffect(() => {
        addEphemeralMessage({
          id: "ephemeral-message",
          content: "Ephemeral message",
        });
        hookAgent.addMessage({
          id: "later-persisted-message",
          role: "user",
          content: "Later persisted message",
        });
      }, [addEphemeralMessage, hookAgent]);

      return (
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      );
    }

    renderWithCopilotKit({
      agent,
      renderCustomMessages: [ephemeralRenderer],
      children: <Harness />,
    });

    await waitFor(() => {
      const list = screen.getByTestId("copilot-message-list");
      expect(list.textContent).toContain("Persisted message");
      expect(list.textContent).toContain("Ephemeral message");
      expect(list.textContent).toContain("Later persisted message");
      expect(list.textContent?.indexOf("Persisted message")).toBeLessThan(
        list.textContent?.indexOf("Ephemeral message") ?? -1,
      );
      expect(list.textContent?.indexOf("Ephemeral message")).toBeLessThan(
        list.textContent?.indexOf("Later persisted message") ?? -1,
      );
    });
  });

  it("keeps a persisted lookalike in history beside an explicit ephemeral card", async () => {
    const agent = new CapturingAgent();
    agent.addMessage({
      id: "ephemeral-card-lookalike",
      role: "user",
      content: "Persisted lookalike",
    });

    function Harness() {
      const { addEphemeralMessage, agent: hookAgent } = useAgent();
      React.useEffect(() => {
        addEphemeralMessage({
          id: "real-ephemeral-card",
          content: "Real ephemeral card",
        });
      }, [addEphemeralMessage, hookAgent]);

      return (
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      );
    }

    renderWithCopilotKit({
      agent,
      renderCustomMessages: [ephemeralRenderer],
      children: <Harness />,
    });

    await waitFor(() => {
      expect(screen.getByText("Persisted lookalike")).toBeDefined();
      expect(
        screen.getByTestId("ephemeral-card-real-ephemeral-card").textContent,
      ).toContain("Real ephemeral card");
    });
  });

  it("isolates ephemeral cards across thread changes and supports remove and clear", async () => {
    const agent = new CapturingAgent();

    function ScopedControls({
      onSwitchThread,
    }: {
      onSwitchThread: () => void;
    }) {
      const {
        addEphemeralMessage,
        removeEphemeralMessage,
        clearEphemeralMessages,
      } = useAgent();

      return (
        <>
          <button
            data-testid="add-scoped-card"
            onClick={() =>
              addEphemeralMessage({
                id: "scoped-card",
                content: "Scoped card",
              })
            }
          >
            Add scoped card
          </button>
          <button
            data-testid="remove-scoped-card"
            onClick={() => removeEphemeralMessage("scoped-card")}
          >
            Remove scoped card
          </button>
          <button
            data-testid="clear-scoped-cards"
            onClick={() => clearEphemeralMessages()}
          >
            Clear scoped cards
          </button>
          <button data-testid="switch-thread" onClick={onSwitchThread}>
            Switch thread
          </button>
        </>
      );
    }

    function Harness() {
      const [threadId, setThreadId] = React.useState("thread-a");
      return (
        <CopilotChatConfigurationProvider
          agentId="default"
          threadId={threadId}
          hasExplicitThreadId={false}
        >
          <ScopedControls onSwitchThread={() => setThreadId("thread-b")} />
          <div style={{ height: 400 }}>
            <CopilotChat welcomeScreen={false} />
          </div>
        </CopilotChatConfigurationProvider>
      );
    }

    render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        renderCustomMessages={[ephemeralRenderer]}
      >
        <Harness />
      </CopilotKitProvider>,
    );

    fireEvent.click(await screen.findByTestId("add-scoped-card"));
    expect(
      await screen.findByTestId("ephemeral-card-scoped-card"),
    ).toBeDefined();

    fireEvent.click(screen.getByTestId("switch-thread"));
    await waitFor(() => {
      expect(screen.queryByTestId("ephemeral-card-scoped-card")).toBeNull();
    });

    fireEvent.click(screen.getByTestId("add-scoped-card"));
    expect(
      await screen.findByTestId("ephemeral-card-scoped-card"),
    ).toBeDefined();
    fireEvent.click(screen.getByTestId("remove-scoped-card"));
    await waitFor(() => {
      expect(screen.queryByTestId("ephemeral-card-scoped-card")).toBeNull();
    });

    fireEvent.click(screen.getByTestId("add-scoped-card"));
    fireEvent.click(screen.getByTestId("clear-scoped-cards"));
    await waitFor(() => {
      expect(screen.queryByTestId("ephemeral-card-scoped-card")).toBeNull();
    });
  });
});
