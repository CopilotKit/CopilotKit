import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Message, RunAgentInput } from "@ag-ui/client";
import {
  GENERATIVE_UI_FUNCTION_CALL_ACTIVITY_TYPE,
  generativeUIFunctionCallMessageId,
} from "@copilotkit/shared";
import type { GenerativeUIFunctionCallContent } from "@copilotkit/shared";
import type * as SharedModule from "@copilotkit/shared";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../providers/CopilotChatConfigurationProvider";
import { CopilotChat } from "../../components/chat/CopilotChat";
import { useCopilotKit } from "../../context";
import {
  MockStepwiseAgent,
  activitySnapshotEvent,
  runFinishedEvent,
  runStartedEvent,
  textChunkEvent,
} from "../../__tests__/utils/test-helpers";
import type { ReactActivityMessageRenderer } from "../../types/react-activity-message-renderer";
import { createGenerativeUI } from "../catalog";
import { useGenerativeUIFunction } from "../hooks";
import type { GenerativeUIConfig } from "../runtime-context";

// The shared test setup gives every randomUUID call the same id. The
// answers of a batch would then share one message id.
vi.mock("@copilotkit/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof SharedModule>()),
  randomUUID: () => crypto.randomUUID(),
}));

class CapturingAgent extends MockStepwiseAgent {
  static inputs: RunAgentInput[] = [];
  run(input: RunAgentInput) {
    CapturingAgent.inputs.push(input);
    return super.run(input);
  }
}

function Button({ label }: { label: string }) {
  return <button>{label}</button>;
}

const ui = createGenerativeUI({
  id: "shop",
  functions: {
    addToCart: { parameters: z.object({ sku: z.string() }) },
  },
  components: {
    Button: { component: Button, props: z.object({ label: z.string() }) },
  },
});

type AddToCartHandler = (args: { sku: string }) => unknown;
type CopilotKit = ReturnType<typeof useCopilotKit>["copilotkit"];

function AddToCart({ handler }: { handler: AddToCartHandler }) {
  useGenerativeUIFunction(ui, "addToCart", handler);
  return null;
}

const addToCart = (
  functionCallId: string,
  args: Record<string, unknown>,
): GenerativeUIFunctionCallContent => ({
  functionCallId,
  callFunction: { "@call": "addToCart", args },
});

/** An a2ui fence with one operation per line. */
function fence(operations: object[]) {
  const body = operations.map((op) => JSON.stringify(op)).join("\n");
  return `\`\`\`a2ui\n${body}\n\`\`\`\n`;
}

const callLine = (call: GenerativeUIFunctionCallContent) => ({
  version: "v1.0",
  callRendererFunction: call,
});

/** How the model sends function calls in one transport. */
interface Transport {
  name: string;
  config: GenerativeUIConfig;
  /** Sends `calls` in the running assistant turn. */
  emitCalls(
    agent: CapturingAgent,
    messageId: string,
    calls: GenerativeUIFunctionCallContent[],
  ): void;
  /** The messages that `calls` leave in the history of a thread. */
  history(
    messageId: string,
    calls: GenerativeUIFunctionCallContent[],
  ): Message[];
}

const toolTransport: Transport = {
  name: "tool",
  config: { ui },
  emitCalls(agent, _messageId, calls) {
    for (const call of calls) {
      agent.emit(
        activitySnapshotEvent({
          messageId: generativeUIFunctionCallMessageId(call.functionCallId),
          activityType: GENERATIVE_UI_FUNCTION_CALL_ACTIVITY_TYPE,
          content: { ...call },
        }),
      );
    }
  },
  history(_messageId, calls) {
    return calls.map((call) => ({
      id: generativeUIFunctionCallMessageId(call.functionCallId),
      role: "activity",
      activityType: GENERATIVE_UI_FUNCTION_CALL_ACTIVITY_TYPE,
      content: { ...call },
    }));
  },
};

const markdownTransport: Transport = {
  name: "markdown",
  config: { ui, transport: "markdown" },
  emitCalls(agent, messageId, calls) {
    agent.emit(
      textChunkEvent(messageId, `Adding it.\n${fence(calls.map(callLine))}`),
    );
  },
  history(messageId, calls) {
    return [
      {
        id: messageId,
        role: "assistant",
        content: `Adding it.\n${fence(calls.map(callLine))}`,
      },
    ];
  },
};

function setup(
  transport: Transport,
  handlers: AddToCartHandler[],
  history: Message[] = [],
) {
  CapturingAgent.inputs = [];
  const agent = new CapturingAgent();
  agent.setMessages(history);
  const captured: { copilotkit?: CopilotKit } = {};
  function Probe() {
    captured.copilotkit = useCopilotKit().copilotkit;
    return null;
  }
  render(
    <CopilotKitProvider
      agents__unsafe_dev_only={{ default: agent }}
      generativeUI={transport.config}
    >
      <Probe />
      {handlers.map((handler, index) => (
        <AddToCart key={index} handler={handler} />
      ))}
    </CopilotKitProvider>,
  );
  return { agent, copilotkit: captured.copilotkit! };
}

async function waitForRuns(count: number) {
  await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(count));
}

/** Adds a user message and starts a run. Resolves when the run started. */
async function startUserTurn(
  copilotkit: CopilotKit,
  agent: CapturingAgent,
  userMessageId: string,
) {
  const runs = CapturingAgent.inputs.length;
  agent.addMessage({ id: userMessageId, role: "user", content: "add it" });
  void copilotkit.runAgent({ agent });
  await waitForRuns(runs + 1);
  agent.emit(runStartedEvent());
}

/** One whole user turn whose only run sends `calls`. */
async function userTurnWithCalls(
  transport: Transport,
  copilotkit: CopilotKit,
  agent: CapturingAgent,
  calls: GenerativeUIFunctionCallContent[],
) {
  await startUserTurn(copilotkit, agent, "u1");
  transport.emitCalls(agent, "m1", calls);
  agent.emit(runFinishedEvent());
}

/** The developer messages of the agent, parsed. */
function answers(agent: CapturingAgent) {
  return agent.messages
    .filter((message) => message.role === "developer")
    .map((message) => JSON.parse(String(message.content)));
}

/** The developer messages that a run sent to the agent, as text. */
function developerContents(input: RunAgentInput | undefined) {
  return (input?.messages ?? [])
    .filter((message) => message.role === "developer")
    .map((message) => message.content);
}

const errorOf = (functionCallId: string, code: string) => ({
  version: "v1.0",
  rendererFunctionResponse: {
    functionCallId,
    error: { code, message: expect.stringContaining("addToCart") },
  },
});

describe.each([toolTransport, markdownTransport])(
  "agent-called functions ($name transport)",
  (transport) => {
    it("runs the call once and sends its result as a developer message in one follow-up run", async () => {
      const handler = vi.fn(({ sku }: { sku: string }) => ({ added: sku }));
      const { agent, copilotkit } = setup(transport, [handler]);

      await userTurnWithCalls(transport, copilotkit, agent, [
        addToCart("f1", { sku: "p1" }),
      ]);

      await waitForRuns(2);
      expect(handler).toHaveBeenCalledExactlyOnceWith({ sku: "p1" });
      expect(developerContents(CapturingAgent.inputs[1])).toEqual([
        '{"version":"v1.0","rendererFunctionResponse":{"functionCallId":"f1","value":{"added":"p1"}}}',
      ]);
    });

    it("answers a handler that returns nothing with a null value", async () => {
      const { agent, copilotkit } = setup(transport, [() => undefined]);

      await userTurnWithCalls(transport, copilotkit, agent, [
        addToCart("f1", { sku: "p1" }),
      ]);

      await waitForRuns(2);
      expect(developerContents(CapturingAgent.inputs[1])).toEqual([
        '{"version":"v1.0","rendererFunctionResponse":{"functionCallId":"f1","value":null}}',
      ]);
    });

    it.each([
      ["function_not_found", [], { sku: "p1" }],
      ["function_conflict", [vi.fn(), vi.fn()], { sku: "p1" }],
      ["invalid_arguments", [vi.fn()], { sku: 42 }],
      [
        "handler_failed",
        [
          () => {
            throw new Error("out of stock");
          },
        ],
        { sku: "p1" },
      ],
    ] satisfies [string, AddToCartHandler[], Record<string, unknown>][])(
      "answers with the %s error and still starts the follow-up run",
      async (code, handlers, args) => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const { agent, copilotkit } = setup(transport, handlers);

        await userTurnWithCalls(transport, copilotkit, agent, [
          addToCart("f1", args),
        ]);

        await waitForRuns(2);
        const sent = developerContents(CapturingAgent.inputs[1]);
        expect(sent.map((content) => JSON.parse(String(content)))).toEqual([
          errorOf("f1", code),
        ]);
        for (const handler of handlers) {
          if (vi.isMockFunction(handler))
            expect(handler).not.toHaveBeenCalled();
        }
      },
    );

    it("answers all calls of one assistant turn in one follow-up run", async () => {
      const handler = vi.fn(({ sku }: { sku: string }) => sku);
      const { agent, copilotkit } = setup(transport, [handler]);

      await userTurnWithCalls(transport, copilotkit, agent, [
        addToCart("f1", { sku: "a" }),
        addToCart("f2", { sku: "b" }),
      ]);

      await waitForRuns(2);
      expect(developerContents(CapturingAgent.inputs[1])).toEqual([
        '{"version":"v1.0","rendererFunctionResponse":{"functionCallId":"f1","value":"a"}}',
        '{"version":"v1.0","rendererFunctionResponse":{"functionCallId":"f2","value":"b"}}',
      ]);
      agent.emit(runStartedEvent());
      agent.emit(runFinishedEvent());
      await act(() => copilotkit.waitForPendingFrameworkUpdates());
      expect(CapturingAgent.inputs).toHaveLength(2);
    });

    it("waits for the run to finish before it answers", async () => {
      const handler = vi.fn(() => "ok");
      const { agent, copilotkit } = setup(transport, [handler]);
      await startUserTurn(copilotkit, agent, "u1");

      transport.emitCalls(agent, "m1", [addToCart("f1", { sku: "p1" })]);
      await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
      await act(() => copilotkit.waitForPendingFrameworkUpdates());

      expect(answers(agent)).toEqual([]);
      expect(CapturingAgent.inputs).toHaveLength(1);

      agent.emit(runFinishedEvent());
      await waitForRuns(2);
      expect(answers(agent)).toHaveLength(1);
    });

    it("does not run a call again when the same messages are read again", async () => {
      const handler = vi.fn(() => "ok");
      const { agent, copilotkit } = setup(transport, [handler]);
      await userTurnWithCalls(transport, copilotkit, agent, [
        addToCart("f1", { sku: "p1" }),
      ]);
      await waitForRuns(2);
      agent.emit(runStartedEvent());
      agent.emit(runFinishedEvent());

      // A replay: the same messages arrive again.
      act(() => agent.setMessages([...agent.messages]));
      await act(() => copilotkit.waitForPendingFrameworkUpdates());

      expect(handler).toHaveBeenCalledTimes(1);
      expect(answers(agent)).toHaveLength(1);
      expect(CapturingAgent.inputs).toHaveLength(2);
    });

    it("on a reload, runs only the calls of the history that have no answer", async () => {
      const handler = vi.fn(({ sku }: { sku: string }) => sku);
      const answered = addToCart("f1", { sku: "old" });
      const unanswered = addToCart("f2", { sku: "new" });
      const history: Message[] = [
        { id: "u0", role: "user", content: "add both" },
        ...transport.history("m0", [answered, unanswered]),
        {
          id: "d1",
          role: "developer",
          content:
            '{"version":"v1.0","rendererFunctionResponse":{"functionCallId":"f1","value":"old"}}',
        },
      ];
      const { agent, copilotkit } = setup(transport, [handler], history);

      await startUserTurn(copilotkit, agent, "u1");
      agent.emit(runFinishedEvent());

      await waitForRuns(2);
      expect(handler).toHaveBeenCalledExactlyOnceWith({ sku: "new" });
      expect(developerContents(CapturingAgent.inputs[1]).at(-1)).toBe(
        '{"version":"v1.0","rendererFunctionResponse":{"functionCallId":"f2","value":"new"}}',
      );
    });

    it("starts at most 5 follow-up runs in one user turn, then answers with follow_up_limit", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const handler = vi.fn(() => "ok");
      const { agent, copilotkit } = setup(transport, [handler]);
      await startUserTurn(copilotkit, agent, "u1");

      // Run 1 is the user run. Runs 2 to 6 are the 5 follow-up runs.
      for (let run = 1; run <= 6; run++) {
        if (run > 1) {
          await waitForRuns(run);
          agent.emit(runStartedEvent());
        }
        transport.emitCalls(agent, `m${run}`, [
          addToCart(`f${run}`, { sku: "p1" }),
        ]);
        agent.emit(runFinishedEvent());
      }

      await waitFor(() => expect(answers(agent)).toHaveLength(6));
      expect(answers(agent).at(-1)).toEqual({
        version: "v1.0",
        rendererFunctionResponse: {
          functionCallId: "f6",
          error: {
            code: "follow_up_limit",
            message: expect.stringContaining("at most 5"),
          },
        },
      });
      expect(handler).toHaveBeenCalledTimes(5);
      await act(() => copilotkit.waitForPendingFrameworkUpdates());
      expect(CapturingAgent.inputs).toHaveLength(6);

      // A new user message starts a new user turn.
      await startUserTurn(copilotkit, agent, "u2");
      transport.emitCalls(agent, "m7", [addToCart("f7", { sku: "p1" })]);
      agent.emit(runFinishedEvent());
      await waitForRuns(8);
      expect(handler).toHaveBeenCalledTimes(6);
    });
  },
);

describe("agent-called functions, markdown transport only", () => {
  it("answers a call line with a wrong shape with invalid_arguments and the reason", async () => {
    const handler = vi.fn();
    const { agent, copilotkit } = setup(markdownTransport, [handler]);
    await startUserTurn(copilotkit, agent, "u1");

    agent.emit(
      textChunkEvent(
        "m1",
        fence([
          {
            version: "v1.0",
            callRendererFunction: {
              functionCallId: "f1",
              callFunction: { call: "addToCart", args: { sku: "p1" } },
            },
          },
        ]),
      ),
    );
    agent.emit(runFinishedEvent());

    await waitForRuns(2);
    expect(answers(agent)).toEqual([
      {
        version: "v1.0",
        rendererFunctionResponse: {
          functionCallId: "f1",
          error: {
            code: "invalid_arguments",
            message:
              'callRendererFunction.callFunction names the function with "@call", not "call"',
          },
        },
      },
    ]);
    expect(handler).not.toHaveBeenCalled();
  });
});

// A wildcard renderer shows every activity that has no renderer of its own.
const wildcardRenderers: ReactActivityMessageRenderer<unknown>[] = [
  {
    activityType: "*",
    content: z.unknown(),
    render: () => <div data-testid="wildcard-activity" />,
  },
];

describe("agent-called functions in the chat", () => {
  const T = "thread-1";

  function setupChat(transport: Transport) {
    CapturingAgent.inputs = [];
    const agent = new CapturingAgent();
    const handler = vi.fn(() => "ok");
    render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        generativeUI={transport.config}
        renderActivityMessages={wildcardRenderers}
      >
        <CopilotChatConfigurationProvider agentId="default" threadId={T}>
          <AddToCart handler={handler} />
          <div style={{ height: 400 }}>
            <CopilotChat welcomeScreen={false} />
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );
    return { agent, handler };
  }

  async function send(text: string) {
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(screen.getByText(text)).toBeTruthy());
  }

  it.each([toolTransport, markdownTransport])(
    "shows nothing for the call and its answer ($name transport)",
    async (transport) => {
      const { agent, handler } = setupChat(transport);
      await send("add it");
      agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
      agent.emit(textChunkEvent("m0", "Sure."));
      transport.emitCalls(agent, "m1", [addToCart("f1", { sku: "p1" })]);
      agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));

      await waitForRuns(2);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(await screen.findByText("Sure.")).toBeTruthy();
      expect(screen.queryByTestId("wildcard-activity")).toBeNull();
      expect(screen.queryByText(/callRendererFunction/)).toBeNull();
      expect(screen.queryByText(/rendererFunctionResponse/)).toBeNull();
      expect(
        document.querySelectorAll("[data-generative-ui-chat-surface]"),
      ).toHaveLength(0);
      agent.emit(runStartedEvent({ threadId: T, runId: "r2" }));
      agent.emit(runFinishedEvent({ threadId: T, runId: "r2" }));
    },
  );
});
