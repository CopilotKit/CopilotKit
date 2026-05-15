import { defineComponent, ref, watch } from "vue";
import type { PropType } from "vue";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/vue";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { AssistantMessage, Message } from "@ag-ui/core";
import { ToolCallStatus } from "@copilotkit/core";
import CopilotChat from "../../components/chat/CopilotChat.vue";
import CopilotChatToolCallsView from "../../components/chat/CopilotChatToolCallsView.vue";
import { useHumanInTheLoop } from "../use-human-in-the-loop";
import {
  MockStepwiseAgent,
  MockReconnectableAgent,
  renderWithCopilotKit,
  runStartedEvent,
  runFinishedEvent,
  toolCallChunkEvent,
  testId,
} from "../../__tests__/utils/test-helpers";

afterEach(() => {
  cleanup();
});

async function submitMessage(value: string) {
  const input = await screen.findByRole("textbox");
  await fireEvent.update(input, value);
  await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => {
    expect(screen.getByText(value)).toBeDefined();
  });
}

/**
 * Wait for any in-flight connect cycle to finish. When a
 * MockReconnectableAgent is used, AbstractAgent.connectAgent sets
 * isRunning = true for the duration of the connect Observable. The chat
 * input treats Enter as "stop" (not "submit") while isRunning is true, so
 * we must wait for the connect to settle before submitting a message.
 */
async function waitForConnectCycleToSettle() {
  // connect() returns from([]).pipe(delay(10)) → ~10ms Observable lifetime
  // plus requestAnimationFrame (setTimeout 16ms in jsdom) in the CopilotChat
  // connect watch finally block.
  await new Promise((r) => setTimeout(r, 50));
  // Let Vue flush any reactive updates triggered by the cycle completing.
  await waitFor(() => {});
}

function createChatHost(registrar: ReturnType<typeof defineComponent>) {
  return defineComponent({
    components: {
      RegisteredComponent: registrar,
      CopilotChat,
    },
    template: `
      <div>
        <RegisteredComponent />
        <div style="height: 400px;">
          <CopilotChat :welcome-screen="false" />
        </div>
      </div>
    `,
  });
}

describe("useHumanInTheLoop E2E - HITL Tool Rendering", () => {
  describe("HITL Renderer with Status Transitions", () => {
    it("should show InProgress → Complete transitions for HITL tool", async () => {
      const agent = new MockStepwiseAgent();
      const statusHistory: ToolCallStatus[] = [];

      const HITLRenderer = defineComponent({
        props: {
          name: { type: String, required: true },
          description: { type: String, required: true },
          status: { type: String as PropType<ToolCallStatus>, required: true },
          args: {
            type: Object as PropType<{ action?: string; reason?: string }>,
            required: true,
          },
          result: { type: String, required: false },
          respond: {
            type: Function as PropType<
              ((result: unknown) => Promise<void>) | undefined
            >,
            required: false,
          },
        },
        setup(props) {
          watch(
            () => props.status,
            (status) => {
              if (statusHistory[statusHistory.length - 1] !== status) {
                statusHistory.push(status);
              }
            },
            { immediate: true, flush: "post" },
          );
          return {};
        },
        template: `
          <div data-testid="hitl-tool">
            <div data-testid="hitl-name">{{ name }}</div>
            <div data-testid="hitl-description">{{ description }}</div>
            <div data-testid="hitl-status">{{ status }}</div>
            <div data-testid="hitl-action">{{ args.action ?? "" }}</div>
            <div data-testid="hitl-reason">{{ args.reason ?? "" }}</div>
            <button
              v-if="respond"
              data-testid="hitl-approve"
              @click="respond(JSON.stringify({ approved: true }))"
            >
              Approve
            </button>
            <div v-if="result" data-testid="hitl-result">{{ result }}</div>
          </div>
        `,
      });

      const HITLComponent = defineComponent({
        setup() {
          const hitlTool = {
            name: "approvalTool",
            description: "Requires human approval",
            parameters: z.object({
              action: z.string(),
              reason: z.string(),
            }),
            render: HITLRenderer,
          };
          useHumanInTheLoop(hitlTool);
          return {};
        },
        template: `<div />`,
      });

      renderWithCopilotKit({
        agent,
        children: createChatHost(HITLComponent),
      });

      await submitMessage("Request approval");

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "approvalTool",
          parentMessageId: messageId,
          delta: JSON.stringify({ action: "delete", reason: "cleanup" }),
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("hitl-status").textContent).toBe(
          ToolCallStatus.InProgress,
        );
        expect(screen.getByTestId("hitl-action").textContent).toBe("delete");
        expect(screen.getByTestId("hitl-reason").textContent).toBe("cleanup");
      });

      await agent.emit(runFinishedEvent());
      await agent.complete();

      const approveButton = await screen.findByTestId("hitl-approve");
      expect(screen.getByTestId("hitl-status").textContent).toBe(
        ToolCallStatus.Executing,
      );

      await fireEvent.click(approveButton);

      await waitFor(() => {
        expect(screen.getByTestId("hitl-status").textContent).toBe(
          ToolCallStatus.Complete,
        );
        expect(screen.getByTestId("hitl-result").textContent).toContain(
          "approved",
        );
        expect(statusHistory).toEqual([
          ToolCallStatus.InProgress,
          ToolCallStatus.Executing,
          ToolCallStatus.Complete,
        ]);
      });
    });
  });

  describe("HITL with Interactive Respond", () => {
    it("should handle interactive respond callback during Executing state", async () => {
      const agent = new MockStepwiseAgent();
      const respondSelections: string[] = [];

      const InteractiveRenderer = defineComponent({
        props: {
          name: { type: String, required: true },
          status: { type: String as PropType<ToolCallStatus>, required: true },
          args: {
            type: Object as PropType<{ question?: string; options?: string[] }>,
            required: true,
          },
          result: { type: String, required: false },
          respond: {
            type: Function as PropType<
              ((result: unknown) => Promise<void>) | undefined
            >,
            required: false,
          },
        },
        setup(props) {
          const respondYes = () => {
            respondSelections.push("yes");
            if (props.respond) {
              void props.respond(JSON.stringify({ answer: "yes" }));
            }
          };

          const respondNo = () => {
            respondSelections.push("no");
            if (props.respond) {
              void props.respond(JSON.stringify({ answer: "no" }));
            }
          };

          return { ToolCallStatus, respondYes, respondNo };
        },
        template: `
          <div data-testid="interactive-hitl">
            <div data-testid="interactive-name">{{ name }}</div>
            <div data-testid="interactive-status">{{ status }}</div>
            <div data-testid="interactive-question">
              {{ args.question ?? "" }}
            </div>
            <div data-testid="interactive-options">
              {{ args.options?.join(", ") ?? "" }}
            </div>

            <div
              v-if="status === ToolCallStatus.Executing && respond"
              data-testid="respond-section"
            >
              <button
                data-testid="respond-yes"
                @click="respondYes"
              >
                Respond Yes
              </button>
              <button
                data-testid="respond-no"
                @click="respondNo"
              >
                Respond No
              </button>
            </div>

            <div v-if="result" data-testid="interactive-result">{{ result }}</div>
          </div>
        `,
      });

      const InteractiveHITLComponent = defineComponent({
        setup() {
          const hitlTool = {
            name: "interactiveTool",
            description: "Interactive human-in-the-loop tool",
            parameters: z.object({
              question: z.string(),
              options: z.array(z.string()),
            }),
            render: InteractiveRenderer,
          };

          useHumanInTheLoop(hitlTool);
          return { respondSelections };
        },
        template: `<div />`,
      });

      renderWithCopilotKit({
        agent,
        children: createChatHost(InteractiveHITLComponent),
      });

      await submitMessage("Interactive question");

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "interactiveTool",
          parentMessageId: messageId,
          delta: JSON.stringify({
            question: "Proceed with operation?",
            options: ["yes", "no"],
          }),
        }),
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("interactive-question").textContent,
        ).toContain("Proceed with operation?");
        expect(screen.getByTestId("interactive-options").textContent).toContain(
          "yes",
        );
        expect(screen.getByTestId("interactive-options").textContent).toContain(
          "no",
        );
      });

      await agent.emit(runFinishedEvent());
      await agent.complete();

      await waitFor(() => {
        expect(screen.getByTestId("interactive-status").textContent).toBe(
          ToolCallStatus.Executing,
        );
        expect(screen.getByTestId("respond-section")).toBeDefined();
      });

      await fireEvent.click(screen.getByTestId("respond-yes"));

      await waitFor(() => {
        expect(screen.getByTestId("interactive-status").textContent).toBe(
          ToolCallStatus.Complete,
        );
        expect(screen.getByTestId("interactive-result").textContent).toContain(
          "yes",
        );
      });

      expect(respondSelections).toEqual(["yes"]);
    });
  });

  describe("Multiple HITL Tools", () => {
    it("should handle multiple HITL tools registered simultaneously", async () => {
      const agent = new MockStepwiseAgent();

      const ReviewRenderer = defineComponent({
        props: {
          name: { type: String, required: true },
          description: { type: String, required: true },
          status: { type: String as PropType<ToolCallStatus>, required: true },
          args: {
            type: Object as PropType<{ changes?: string[] }>,
            required: true,
          },
        },
        template: `
          <div data-testid="review-tool">
            {{ name }} - {{ description }} | Status: {{ status }} | Changes:
            {{ args.changes?.length ?? 0 }}
          </div>
        `,
      });

      const ConfirmRenderer = defineComponent({
        props: {
          name: { type: String, required: true },
          description: { type: String, required: true },
          status: { type: String as PropType<ToolCallStatus>, required: true },
          args: {
            type: Object as PropType<{ action?: string }>,
            required: true,
          },
        },
        template: `
          <div data-testid="confirm-tool">
            {{ name }} - {{ description }} | Status: {{ status }} | Action:
            {{ args.action ?? "" }}
          </div>
        `,
      });

      const MultipleHITLComponent = defineComponent({
        setup() {
          const reviewTool = {
            name: "reviewTool",
            description: "Review changes",
            parameters: z.object({ changes: z.array(z.string()) }),
            render: ReviewRenderer,
          };

          const confirmTool = {
            name: "confirmTool",
            description: "Confirm action",
            parameters: z.object({ action: z.string() }),
            render: ConfirmRenderer,
          };

          useHumanInTheLoop(reviewTool);
          useHumanInTheLoop(confirmTool);
          return {};
        },
        template: `<div />`,
      });

      renderWithCopilotKit({
        agent,
        children: createChatHost(MultipleHITLComponent),
      });

      await submitMessage("Multiple HITL");

      const messageId = testId("msg");
      const toolCallId1 = testId("tc1");
      const toolCallId2 = testId("tc2");

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId: toolCallId1,
          toolCallName: "reviewTool",
          parentMessageId: messageId,
          delta: JSON.stringify({ changes: ["file1.ts", "file2.ts"] }),
        }),
      );
      await agent.emit(
        toolCallChunkEvent({
          toolCallId: toolCallId2,
          toolCallName: "confirmTool",
          parentMessageId: messageId,
          delta: JSON.stringify({ action: "deploy" }),
        }),
      );

      await waitFor(() => {
        const reviewTool = screen.getByTestId("review-tool");
        const confirmTool = screen.getByTestId("confirm-tool");
        expect(reviewTool.textContent).toContain("Changes: 2");
        expect(confirmTool.textContent).toContain("Action: deploy");
        expect(reviewTool.textContent).toContain(ToolCallStatus.InProgress);
        expect(confirmTool.textContent).toContain(ToolCallStatus.InProgress);
      });

      await agent.emit(runFinishedEvent());
      await agent.complete();
    });
  });

  describe("Multiple Hook Instances", () => {
    it("should isolate state across two useHumanInTheLoop registrations", async () => {
      const agent = new MockStepwiseAgent();

      const PrimaryRenderer = defineComponent({
        props: {
          status: { type: String as PropType<ToolCallStatus>, required: true },
          args: {
            type: Object as PropType<{ action?: string }>,
            required: true,
          },
          result: { type: String, required: false },
          respond: {
            type: Function as PropType<
              ((result: unknown) => Promise<void>) | undefined
            >,
            required: false,
          },
        },
        template: `
          <div data-testid="primary-tool">
            <div data-testid="primary-status">{{ status }}</div>
            <div data-testid="primary-action">{{ args.action ?? "" }}</div>
            <button
              v-if="respond"
              data-testid="primary-respond"
              @click="respond(JSON.stringify({ approved: true }))"
            >
              Respond Primary
            </button>
            <div v-if="result" data-testid="primary-result">{{ result }}</div>
          </div>
        `,
      });

      const SecondaryRenderer = defineComponent({
        props: {
          status: { type: String as PropType<ToolCallStatus>, required: true },
          args: {
            type: Object as PropType<{ detail?: string }>,
            required: true,
          },
          result: { type: String, required: false },
          respond: {
            type: Function as PropType<
              ((result: unknown) => Promise<void>) | undefined
            >,
            required: false,
          },
        },
        template: `
          <div data-testid="secondary-tool">
            <div data-testid="secondary-status">{{ status }}</div>
            <div data-testid="secondary-detail">{{ args.detail ?? "" }}</div>
            <button
              v-if="respond"
              data-testid="secondary-respond"
              @click="respond(JSON.stringify({ confirmed: true }))"
            >
              Respond Secondary
            </button>
            <div v-if="result" data-testid="secondary-result">{{ result }}</div>
          </div>
        `,
      });

      const DualHookComponent = defineComponent({
        setup() {
          const primaryTool = {
            name: "primaryTool",
            description: "Primary approval tool",
            parameters: z.object({ action: z.string() }),
            render: PrimaryRenderer,
          };

          const secondaryTool = {
            name: "secondaryTool",
            description: "Secondary approval tool",
            parameters: z.object({ detail: z.string() }),
            render: SecondaryRenderer,
          };

          useHumanInTheLoop(primaryTool);
          useHumanInTheLoop(secondaryTool);
          return {};
        },
        template: `<div />`,
      });

      renderWithCopilotKit({
        agent,
        children: createChatHost(DualHookComponent),
      });

      await submitMessage("Dual hook instance");

      const messageId = testId("msg");
      const primaryToolCallId = testId("tc-primary");
      const secondaryToolCallId = testId("tc-secondary");

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId: primaryToolCallId,
          toolCallName: "primaryTool",
          parentMessageId: messageId,
          delta: JSON.stringify({ action: "archive" }),
        }),
      );
      await agent.emit(
        toolCallChunkEvent({
          toolCallId: secondaryToolCallId,
          toolCallName: "secondaryTool",
          parentMessageId: messageId,
          delta: JSON.stringify({ detail: "requires confirmation" }),
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("primary-status").textContent).toBe(
          ToolCallStatus.InProgress,
        );
        expect(screen.getByTestId("primary-action").textContent).toBe(
          "archive",
        );
        expect(screen.getByTestId("secondary-status").textContent).toBe(
          ToolCallStatus.InProgress,
        );
        expect(screen.getByTestId("secondary-detail").textContent).toBe(
          "requires confirmation",
        );
      });

      await agent.emit(runFinishedEvent());
      await agent.complete();

      const primaryRespondButton = await screen.findByTestId("primary-respond");

      expect(screen.getByTestId("primary-status").textContent).toBe(
        ToolCallStatus.Executing,
      );
      expect(screen.getByTestId("secondary-status").textContent).toBe(
        ToolCallStatus.InProgress,
      );
      expect(screen.queryByTestId("secondary-respond")).toBeNull();

      await fireEvent.click(primaryRespondButton);

      await waitFor(() => {
        expect(screen.getByTestId("primary-status").textContent).toBe(
          ToolCallStatus.Complete,
        );
        expect(screen.getByTestId("primary-result").textContent).toContain(
          "approved",
        );
        expect(screen.getByTestId("secondary-status").textContent).toBe(
          ToolCallStatus.Executing,
        );
        expect(screen.queryByTestId("secondary-result")).toBeNull();
      });

      const secondaryRespondButton =
        await screen.findByTestId("secondary-respond");

      await fireEvent.click(secondaryRespondButton);

      await waitFor(() => {
        expect(screen.getByTestId("secondary-status").textContent).toBe(
          ToolCallStatus.Complete,
        );
        expect(screen.getByTestId("secondary-result").textContent).toContain(
          "confirmed",
        );
      });
    });
  });

  describe("HITL Tool with Dynamic Registration", () => {
    it("should support dynamic registration and unregistration of HITL tools", async () => {
      const agent = new MockStepwiseAgent();

      const DynamicRenderer = defineComponent({
        props: {
          name: { type: String, required: true },
          description: { type: String, required: true },
          args: { type: Object as PropType<{ data?: string }>, required: true },
        },
        template: `
          <div data-testid="dynamic-hitl">
            {{ name }}: {{ description }} | Data: {{ args.data ?? "" }}
          </div>
        `,
      });

      const DynamicHITLComponent = defineComponent({
        setup() {
          const dynamicHitl = {
            name: "dynamicHitl",
            description: "Dynamically registered HITL",
            parameters: z.object({ data: z.string() }),
            render: DynamicRenderer,
          };

          useHumanInTheLoop(dynamicHitl);
          return {};
        },
        template: `<div data-testid="hitl-enabled">HITL Enabled</div>`,
      });

      const TestWrapper = defineComponent({
        components: { DynamicHITLComponent, CopilotChat },
        setup() {
          const enabled = ref(false);
          const toggle = () => {
            enabled.value = !enabled.value;
          };
          return { enabled, toggle };
        },
        template: `
          <div>
            <button data-testid="toggle-hitl" @click="toggle">
              Toggle HITL
            </button>
            <DynamicHITLComponent v-if="enabled" />
            <div style="height: 400px;">
              <CopilotChat :welcome-screen="false" />
            </div>
          </div>
        `,
      });

      renderWithCopilotKit({
        agent,
        children: TestWrapper,
      });

      expect(screen.queryByTestId("hitl-enabled")).toBeNull();

      const toggleButton = screen.getByTestId("toggle-hitl");
      await fireEvent.click(toggleButton);

      await waitFor(() => {
        expect(screen.getByTestId("hitl-enabled")).toBeDefined();
      });

      await submitMessage("Test dynamic HITL");

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "dynamicHitl",
          parentMessageId: messageId,
          delta: JSON.stringify({ data: "test data" }),
        }),
      );

      await waitFor(() => {
        const dynamicHitl = screen.getByTestId("dynamic-hitl");
        expect(dynamicHitl.textContent).toContain("dynamicHitl");
        expect(dynamicHitl.textContent).toContain("test data");
      });

      await agent.emit(runFinishedEvent());

      await fireEvent.click(toggleButton);

      await waitFor(() => {
        expect(screen.queryByTestId("hitl-enabled")).toBeNull();
      });

      await submitMessage("Test after disable");

      const messageId2 = testId("msg2");
      const toolCallId2 = testId("tc2");

      await agent.emit(runStartedEvent());
      await agent.emit(
        toolCallChunkEvent({
          toolCallId: toolCallId2,
          toolCallName: "dynamicHitl",
          parentMessageId: messageId2,
          delta: JSON.stringify({ data: "should not render" }),
        }),
      );

      await waitFor(
        () => {
          const dynamicRenders = screen.queryAllByTestId("dynamic-hitl");
          expect(dynamicRenders.length).toBe(0);
          expect(screen.queryByText(/should not render/)).toBeNull();
        },
        { timeout: 200 },
      );

      await agent.emit(runFinishedEvent());
      await agent.complete();
    });
  });

  describe("useHumanInTheLoop dependencies", () => {
    it("updates HITL renderer when optional deps change", async () => {
      const DependencyDrivenHITLComponent = defineComponent({
        components: { CopilotChatToolCallsView },
        setup() {
          const version = ref(0);

          const hitlTool = {
            name: "dependencyHitlTool",
            description: "Dependency-driven HITL tool",
            parameters: z.object({ message: z.string() }),
            render: defineComponent({
              props: {
                args: {
                  type: Object as PropType<{ message?: string }>,
                  required: true,
                },
              },
              setup(props) {
                return { props, version };
              },
              template: `
                <div data-testid="dependency-hitl-render">
                  {{ props.args.message }} (v{{ version }})
                </div>
              `,
            }),
          };

          useHumanInTheLoop(hitlTool, [version]);

          const toolCallId = testId("hitl_dep_tc");
          const assistantMessage: AssistantMessage = {
            id: testId("hitl_dep_a"),
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: toolCallId,
                type: "function",
                function: {
                  name: "dependencyHitlTool",
                  arguments: JSON.stringify({ message: "hello" }),
                },
              } as any,
            ],
          } as any;
          const messages: Message[] = [];

          const bumpVersion = () => {
            version.value += 1;
          };

          return {
            assistantMessage,
            messages,
            bumpVersion,
          };
        },
        template: `
          <div>
            <button
              data-testid="hitl-bump-version"
              type="button"
              @click="bumpVersion"
            >
              Bump
            </button>
            <CopilotChatToolCallsView
              :message="assistantMessage"
              :messages="messages"
            />
          </div>
        `,
      });

      renderWithCopilotKit({
        children: DependencyDrivenHITLComponent,
      });

      await waitFor(() => {
        const el = screen.getByTestId("dependency-hitl-render");
        expect(el).toBeDefined();
        expect(el.textContent).toContain("hello");
        expect(el.textContent).toContain("(v0)");
      });

      await fireEvent.click(screen.getByTestId("hitl-bump-version"));

      await waitFor(() => {
        const el = screen.getByTestId("dependency-hitl-render");
        expect(el.textContent).toContain("(v1)");
      });
    });
  });
});

describe("HITL Thread Reconnection Bug", () => {
  it("should show executing status when reconnecting to thread with pending HITL", async () => {
    const agent = new MockReconnectableAgent();

    const HITLRenderer = defineComponent({
      props: {
        status: { type: String as PropType<ToolCallStatus>, required: true },
        args: { type: Object as PropType<{ action?: string }>, required: true },
        respond: {
          type: Function as PropType<
            ((result: unknown) => Promise<void>) | undefined
          >,
          required: false,
        },
      },
      template: `
        <div data-testid="hitl-tool">
          <div data-testid="hitl-status">{{ status }}</div>
          <div data-testid="hitl-action">{{ args.action ?? "no-action" }}</div>
          <button v-if="respond" data-testid="hitl-respond">Respond</button>
        </div>
      `,
    });

    const HITLComponent = defineComponent({
      setup() {
        const hitlTool = {
          name: "approvalTool",
          description: "Requires human approval",
          parameters: z.object({ action: z.string() }),
          render: HITLRenderer,
        };
        useHumanInTheLoop(hitlTool);
        return {};
      },
      template: `<div />`,
    });

    const { unmount } = renderWithCopilotKit({
      agent,
      children: createChatHost(HITLComponent),
    });

    // MockReconnectableAgent triggers a connect cycle on mount (because the
    // provider sets an explicit threadId). AbstractAgent.connectAgent sets
    // isRunning = true for the duration of the connect Observable, which
    // causes the chat input to treat Enter as "stop" instead of "submit".
    // Wait for the connect cycle to finish before attempting to submit.
    await waitForConnectCycleToSettle();

    await submitMessage("Request approval");

    const messageId = testId("msg");
    const toolCallId = testId("tc");

    await agent.emit(runStartedEvent());
    await agent.emit(
      toolCallChunkEvent({
        toolCallId,
        toolCallName: "approvalTool",
        parentMessageId: messageId,
        delta: JSON.stringify({ action: "delete" }),
      }),
    );

    // While the agent is still running, the HITL tool should be InProgress.
    await waitFor(() => {
      expect(screen.getByTestId("hitl-status").textContent).toBe(
        ToolCallStatus.InProgress,
      );
    });

    await agent.emit(runFinishedEvent());
    await agent.complete();

    // After the run finishes the tool transitions to Executing (awaiting
    // human response).
    await waitFor(() => {
      expect(screen.getByTestId("hitl-status").textContent).toBe(
        ToolCallStatus.Executing,
      );
    });

    unmount();
    agent.reset();

    renderWithCopilotKit({
      agent,
      children: createChatHost(HITLComponent),
    });

    await waitFor(() => {
      expect(screen.getByTestId("hitl-tool")).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByTestId("hitl-action").textContent).toBe("delete");
    });

    await waitFor(() => {
      expect(screen.getByTestId("hitl-status").textContent).toBe(
        ToolCallStatus.Executing,
      );
    });

    expect(screen.getByTestId("hitl-respond")).toBeDefined();
  });

  it("should handle tool call after connect (fresh run)", async () => {
    const agent = new MockReconnectableAgent();

    const TaskRenderer = defineComponent({
      props: {
        status: { type: String as PropType<ToolCallStatus>, required: true },
        args: { type: Object as PropType<{ task?: string }>, required: true },
        respond: {
          type: Function as PropType<
            ((result: unknown) => Promise<void>) | undefined
          >,
          required: false,
        },
      },
      template: `
        <div data-testid="task-tool">
          <div data-testid="task-status">{{ status }}</div>
          <div data-testid="task-name">{{ args.task ?? "no-task" }}</div>
          <button
            v-if="respond"
            data-testid="task-respond"
            @click="respond('done')"
          >
            Done
          </button>
        </div>
      `,
    });

    const HITLComponent = defineComponent({
      setup() {
        const hitlTool = {
          name: "taskTool",
          description: "Task approval",
          parameters: z.object({ task: z.string() }),
          render: TaskRenderer,
        };
        useHumanInTheLoop(hitlTool);
        return {};
      },
      template: `<div />`,
    });

    renderWithCopilotKit({
      agent,
      children: createChatHost(HITLComponent),
    });

    // Same connect-cycle settling as the reconnection test above.
    await waitForConnectCycleToSettle();

    await submitMessage("Start task");

    const messageId = testId("msg");
    const toolCallId = testId("tc");

    await agent.emit(runStartedEvent());
    await agent.emit(
      toolCallChunkEvent({
        toolCallId,
        toolCallName: "taskTool",
        parentMessageId: messageId,
        delta: JSON.stringify({ task: "review PR" }),
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("task-status").textContent).toBe(
        ToolCallStatus.InProgress,
      );
      expect(screen.getByTestId("task-name").textContent).toBe("review PR");
    });

    await agent.emit(runFinishedEvent());
    await agent.complete();

    await waitFor(() => {
      expect(screen.getByTestId("task-status").textContent).toBe(
        ToolCallStatus.Executing,
      );
    });

    const respondButton = screen.getByTestId("task-respond");
    await fireEvent.click(respondButton);

    await waitFor(() => {
      expect(screen.getByTestId("task-status").textContent).toBe(
        ToolCallStatus.Complete,
      );
    });
  });

  it("should handle multiple sequential tool calls (HITL executes one at a time)", async () => {
    const agent = new MockStepwiseAgent();

    const Tool1Renderer = defineComponent({
      props: {
        status: { type: String as PropType<ToolCallStatus>, required: true },
        args: { type: Object as PropType<{ id?: string }>, required: true },
        respond: {
          type: Function as PropType<
            ((result: unknown) => Promise<void>) | undefined
          >,
          required: false,
        },
      },
      template: `
        <div data-testid="tool1">
          <div data-testid="tool1-status">{{ status }}</div>
          <div data-testid="tool1-id">{{ args.id ?? "" }}</div>
          <button
            v-if="respond"
            data-testid="tool1-respond"
            @click="respond('ok')"
          >
            OK
          </button>
        </div>
      `,
    });

    const Tool2Renderer = defineComponent({
      props: {
        status: { type: String as PropType<ToolCallStatus>, required: true },
        args: { type: Object as PropType<{ id?: string }>, required: true },
        respond: {
          type: Function as PropType<
            ((result: unknown) => Promise<void>) | undefined
          >,
          required: false,
        },
      },
      template: `
        <div data-testid="tool2">
          <div data-testid="tool2-status">{{ status }}</div>
          <div data-testid="tool2-id">{{ args.id ?? "" }}</div>
          <button
            v-if="respond"
            data-testid="tool2-respond"
            @click="respond('ok')"
          >
            OK
          </button>
        </div>
      `,
    });

    const MultiToolComponent = defineComponent({
      setup() {
        const tool1 = {
          name: "tool1",
          description: "First tool",
          parameters: z.object({ id: z.string() }),
          render: Tool1Renderer,
        };

        const tool2 = {
          name: "tool2",
          description: "Second tool",
          parameters: z.object({ id: z.string() }),
          render: Tool2Renderer,
        };

        useHumanInTheLoop(tool1);
        useHumanInTheLoop(tool2);
        return {};
      },
      template: `<div />`,
    });

    renderWithCopilotKit({
      agent,
      children: createChatHost(MultiToolComponent),
    });

    await submitMessage("Multiple tools");

    const messageId = testId("msg");
    const tc1 = testId("tc1");
    const tc2 = testId("tc2");

    await agent.emit(runStartedEvent());
    await agent.emit(
      toolCallChunkEvent({
        toolCallId: tc1,
        toolCallName: "tool1",
        parentMessageId: messageId,
        delta: JSON.stringify({ id: "first" }),
      }),
    );
    await agent.emit(
      toolCallChunkEvent({
        toolCallId: tc2,
        toolCallName: "tool2",
        parentMessageId: messageId,
        delta: JSON.stringify({ id: "second" }),
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("tool1-status").textContent).toBe(
        ToolCallStatus.InProgress,
      );
      expect(screen.getByTestId("tool2-status").textContent).toBe(
        ToolCallStatus.InProgress,
      );
    });

    await agent.emit(runFinishedEvent());
    await agent.complete();

    await waitFor(() => {
      expect(screen.getByTestId("tool1-status").textContent).toBe(
        ToolCallStatus.Executing,
      );
      expect(screen.getByTestId("tool2-status").textContent).toBe(
        ToolCallStatus.InProgress,
      );
    });

    await fireEvent.click(screen.getByTestId("tool1-respond"));

    await waitFor(() => {
      expect(screen.getByTestId("tool1-status").textContent).toBe(
        ToolCallStatus.Complete,
      );
      expect(screen.getByTestId("tool2-status").textContent).toBe(
        ToolCallStatus.Executing,
      );
    });

    await fireEvent.click(screen.getByTestId("tool2-respond"));

    await waitFor(() => {
      expect(screen.getByTestId("tool2-status").textContent).toBe(
        ToolCallStatus.Complete,
      );
    });
  });

  it("should handle late-mounting component that renders executing tool", async () => {
    const agent = new MockStepwiseAgent();

    const LateRenderer = defineComponent({
      props: {
        status: { type: String as PropType<ToolCallStatus>, required: true },
        args: { type: Object as PropType<{ data?: string }>, required: true },
      },
      template: `
        <div data-testid="late-tool">
          <div data-testid="late-status">{{ status }}</div>
          <div data-testid="late-data">{{ args.data ?? "" }}</div>
        </div>
      `,
    });

    const ToggleableHITL = defineComponent({
      setup() {
        const showTool = ref(false);

        const hitlTool = {
          name: "lateTool",
          description: "Late mounting tool",
          parameters: z.object({ data: z.string() }),
          render: LateRenderer,
        };

        useHumanInTheLoop(hitlTool);

        const show = () => {
          showTool.value = true;
        };

        return { showTool, show };
      },
      template: `
        <div>
          <button data-testid="show-late-tool" @click="show">
            Show Tool
          </button>
          <div v-if="showTool" data-testid="late-tool-container">Tool is visible</div>
        </div>
      `,
    });

    renderWithCopilotKit({
      agent,
      children: createChatHost(ToggleableHITL),
    });

    await submitMessage("Test late mount");

    const messageId = testId("msg");
    const toolCallId = testId("tc");

    await agent.emit(runStartedEvent());
    await agent.emit(
      toolCallChunkEvent({
        toolCallId,
        toolCallName: "lateTool",
        parentMessageId: messageId,
        delta: JSON.stringify({ data: "late-data" }),
      }),
    );
    await agent.emit(runFinishedEvent());
    await agent.complete();

    await waitFor(() => {
      expect(screen.getByTestId("late-status").textContent).toBe(
        ToolCallStatus.Executing,
      );
    });

    await fireEvent.click(screen.getByTestId("show-late-tool"));

    await waitFor(() => {
      expect(screen.getByTestId("late-tool-container")).toBeDefined();
    });

    expect(screen.getByTestId("late-status").textContent).toBe(
      ToolCallStatus.Executing,
    );
  });

  it("should maintain executing state across component remount", async () => {
    const agent = new MockStepwiseAgent();

    const RemountRenderer = defineComponent({
      props: {
        status: { type: String as PropType<ToolCallStatus>, required: true },
        args: { type: Object as PropType<{ action?: string }>, required: true },
        respond: {
          type: Function as PropType<
            ((result: unknown) => Promise<void>) | undefined
          >,
          required: false,
        },
      },
      template: `
        <div data-testid="remount-tool">
          <div data-testid="remount-status">{{ status }}</div>
          <div data-testid="remount-action">{{ args.action ?? "" }}</div>
          <button v-if="respond" data-testid="remount-respond">Done</button>
        </div>
      `,
    });

    const HITLChild = defineComponent({
      setup() {
        const hitlTool = {
          name: "remountTool",
          description: "Remountable tool",
          parameters: z.object({ action: z.string() }),
          render: RemountRenderer,
        };

        useHumanInTheLoop(hitlTool);
        return {};
      },
      template: `<div />`,
    });

    const RemountableHITL = defineComponent({
      components: { HITLChild },
      setup() {
        const keyValue = ref(0);
        const remount = () => {
          keyValue.value += 1;
        };
        return { keyValue, remount };
      },
      template: `
        <div>
          <button data-testid="remount-toggle" @click="remount">Remount</button>
          <HITLChild :key="keyValue" />
        </div>
      `,
    });

    renderWithCopilotKit({
      agent,
      children: createChatHost(RemountableHITL),
    });

    await submitMessage("Test remount");

    const messageId = testId("msg");
    const toolCallId = testId("tc");

    await agent.emit(runStartedEvent());
    await agent.emit(
      toolCallChunkEvent({
        toolCallId,
        toolCallName: "remountTool",
        parentMessageId: messageId,
        delta: JSON.stringify({ action: "test-action" }),
      }),
    );
    await agent.emit(runFinishedEvent());
    await agent.complete();

    await waitFor(() => {
      expect(screen.getByTestId("remount-status").textContent).toBe(
        ToolCallStatus.Executing,
      );
      expect(screen.getByTestId("remount-action").textContent).toBe(
        "test-action",
      );
    });

    await fireEvent.click(screen.getByTestId("remount-toggle"));

    await waitFor(() => {
      expect(screen.getByTestId("remount-status").textContent).toBe(
        ToolCallStatus.Executing,
      );
      expect(screen.getByTestId("remount-action").textContent).toBe(
        "test-action",
      );
    });

    expect(screen.getByTestId("remount-respond")).toBeDefined();
  });
});
