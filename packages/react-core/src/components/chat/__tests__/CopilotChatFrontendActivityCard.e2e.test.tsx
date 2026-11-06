/**
 * Frontend-driven activity cards (issue #3388).
 *
 * A `role: "activity"` message added from frontend code renders standalone in
 * the transcript, and `AbstractAgent.prepareRunAgentInput` strips it from the
 * run payload — so the card never reaches the agent or the LLM. This is the
 * supported way to put a card in the transcript without a tool call and
 * without polluting the conversation.
 */
import React from "react";
import { screen, waitFor, act } from "@testing-library/react";
import { z } from "zod";
import type { RunAgentInput } from "@ag-ui/core";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
} from "../../../__tests__/utils/test-helpers";
import { CopilotChat } from "../CopilotChat";
import { useAgent } from "../../../hooks/use-agent";
import { CopilotKitCoreReact } from "../../../lib/react-core";
import type { ReactActivityMessageRenderer } from "../../../types";

// Test shim: some environments lack setCredentials on CopilotKitCoreReact.
if (!(CopilotKitCoreReact.prototype as any).setCredentials) {
  (CopilotKitCoreReact.prototype as any).setCredentials = () => {};
}

const contentSchema = z.object({ title: z.string() });

const cardRenderer: ReactActivityMessageRenderer<
  z.infer<typeof contentSchema>
> = {
  activityType: "app-event-card",
  content: contentSchema,
  render: ({ content }) => (
    <div data-testid="app-event-card">{content.title}</div>
  ),
};

/** Captures the RunAgentInput the agent is actually invoked with. */
class InputCapturingAgent extends MockStepwiseAgent {
  lastInput?: RunAgentInput;
  run(input: RunAgentInput) {
    this.lastInput = input;
    return super.run(input);
  }
}

/**
 * Stands in for application code that reacts to a frontend event — a websocket
 * push, an `agent.subscribe` callback, a button — and drops a card into the
 * transcript. `useAgent()` is what hands back the live agent instance; a raw
 * agent reference held outside React is not the instance the chat renders.
 */
function CardEmitter({ onAgent }: { onAgent: (agent: any) => void }) {
  const { agent } = useAgent();
  React.useEffect(() => {
    onAgent(agent);
  }, [agent, onAgent]);
  return null;
}

describe("frontend-driven activity cards (#3388)", () => {
  it("renders a card added from frontend code, with no tool call", async () => {
    let liveAgent: any;
    renderWithCopilotKit({
      agent: new InputCapturingAgent(),
      renderActivityMessages: [cardRenderer],
      children: (
        <>
          <CardEmitter onAgent={(a) => (liveAgent = a)} />
          <CopilotChat />
        </>
      ),
    });

    await waitFor(() => expect(liveAgent).toBeDefined());

    await act(async () => {
      liveAgent.addMessage({
        id: "card-1",
        role: "activity",
        activityType: "app-event-card",
        content: { title: "Deployment finished" },
      });
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() => {
      expect(screen.getByTestId("app-event-card").textContent).toBe(
        "Deployment finished",
      );
    });
  });

  it("excludes the card from the run payload sent to the agent", async () => {
    let liveAgent: any;
    renderWithCopilotKit({
      agent: new InputCapturingAgent(),
      renderActivityMessages: [cardRenderer],
      children: (
        <>
          <CardEmitter onAgent={(a) => (liveAgent = a)} />
          <CopilotChat />
        </>
      ),
    });

    await waitFor(() => expect(liveAgent).toBeDefined());

    await act(async () => {
      liveAgent.addMessage({ id: "u1", role: "user", content: "hello" });
      liveAgent.addMessage({
        id: "card-1",
        role: "activity",
        activityType: "app-event-card",
        content: { title: "Deployment finished" },
      });
      await new Promise((r) => setTimeout(r, 0));
    });

    // Kick off a run without awaiting it: the mock agent's stream stays open,
    // and the payload is captured synchronously when run() is invoked.
    void liveAgent.runAgent({});
    await waitFor(() => expect(liveAgent.lastInput).toBeDefined());

    // The card stays in the client transcript...
    expect(liveAgent.messages.map((m: any) => m.role)).toEqual([
      "user",
      "activity",
    ]);
    // ...but never reaches the agent.
    expect(liveAgent.lastInput.messages.map((m: any) => m.role)).toEqual([
      "user",
    ]);
  });
});
