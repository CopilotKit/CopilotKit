import { defineComponent } from "vue";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/vue";
import { afterEach, describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/client";
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
import { useCopilotKit } from "../../providers/useCopilotKit";
import CopilotChat from "../../components/chat/CopilotChat.vue";

class StateCapturingMockAgent extends MockStepwiseAgent {
  public lastRunInput?: RunAgentInput;

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.lastRunInput = input;
    return super.run(input);
  }
}

afterEach(() => {
  cleanup();
});

describe("useAgent e2e", () => {
  describe("setState passes state to agent run", () => {
    it("agent receives state set via setState when runAgent is called", async () => {
      const agent = new StateCapturingMockAgent();

      const StateTestComponent = defineComponent({
        setup() {
          const { agent: hookAgent } = useAgent();
          const { copilotkit } = useCopilotKit();

          const handleSetStateAndRun = async () => {
            hookAgent.value.setState({ testKey: "testValue", counter: 42 });
            await copilotkit.value.runAgent({ agent: hookAgent.value });
          };

          return { handleSetStateAndRun };
        },
        template: `
          <button data-testid="trigger-btn" @click="handleSetStateAndRun">
            Set State and Run
          </button>
        `,
      });

      renderWithCopilotKit({
        agent,
        children: StateTestComponent,
      });

      const triggerBtn = await screen.findByTestId("trigger-btn");
      await fireEvent.click(triggerBtn);

      await waitFor(() => {
        expect(agent.lastRunInput).toBeDefined();
      });

      await agent.emit(runStartedEvent());
      await agent.emit(runFinishedEvent());
      await agent.complete();

      expect(agent.lastRunInput?.state).toEqual({
        testKey: "testValue",
        counter: 42,
      });
    });
  });

  describe("addMessage + runAgent displays in CopilotChat", () => {
    it("messages added via useAgent show up in CopilotChat", async () => {
      const agent = new MockStepwiseAgent();

      const MessageTestComponent = defineComponent({
        components: { CopilotChat },
        setup() {
          const { agent: hookAgent } = useAgent();
          const { copilotkit } = useCopilotKit();

          const handleAddMessageAndRun = async () => {
            hookAgent.value.addMessage({
              id: testId("user-msg"),
              role: "user",
              content: "Hello from useAgent!",
            } as any);
            await copilotkit.value.runAgent({ agent: hookAgent.value });
          };

          return { handleAddMessageAndRun };
        },
        template: `
          <div>
            <button data-testid="send-btn" @click="handleAddMessageAndRun">
              Send Message
            </button>
            <div style="height: 400px;">
              <CopilotChat :welcome-screen="false" />
            </div>
          </div>
        `,
      });

      renderWithCopilotKit({
        agent,
        children: MessageTestComponent,
      });

      const sendBtn = await screen.findByTestId("send-btn");
      await fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(screen.getByText("Hello from useAgent!")).toBeDefined();
      });

      const responseId = testId("assistant-msg");
      await agent.emit(runStartedEvent());
      await agent.emit(
        textChunkEvent(responseId, "Hello! I received your message."),
      );
      await agent.emit(runFinishedEvent());
      await agent.complete();

      await waitFor(() => {
        expect(
          screen.getByText("Hello! I received your message."),
        ).toBeDefined();
      });
    });
  });

  describe("run error lifecycle", () => {
    it("updates useAgent subscribers when run ends with RUN_ERROR", async () => {
      const agent = new MockStepwiseAgent();

      const RunErrorStatusComponent = defineComponent({
        setup() {
          const { agent: hookAgent } = useAgent();
          const { copilotkit } = useCopilotKit();

          const handleRun = async () => {
            await copilotkit.value.runAgent({ agent: hookAgent.value });
          };

          return { hookAgent, handleRun };
        },
        template: `
          <div>
            <button data-testid="run-btn" @click="handleRun">Run</button>
            <span data-testid="status">{{ hookAgent?.isRunning ? "running" : "idle" }}</span>
          </div>
        `,
      });

      renderWithCopilotKit({
        agent,
        children: RunErrorStatusComponent,
      });

      expect(screen.getByTestId("status").textContent).toBe("idle");

      await fireEvent.click(screen.getByTestId("run-btn"));
      await agent.emit(runStartedEvent());

      await waitFor(() => {
        expect(screen.getByTestId("status").textContent).toBe("running");
      });

      await agent.emit({
        type: EventType.RUN_ERROR,
      } as BaseEvent);
      await agent.complete();

      await waitFor(() => {
        expect(screen.getByTestId("status").textContent).toBe("idle");
      });
    });
  });
});
