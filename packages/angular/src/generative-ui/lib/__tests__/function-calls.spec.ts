import {
  Component,
  EnvironmentInjector,
  createEnvironmentInjector,
  input,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Subject, takeWhile } from "rxjs";
import type { Observable } from "rxjs";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  ActivityMessage,
  BaseEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import { z } from "zod";
import {
  CopilotChat,
  CopilotKit,
  provideCopilotChatConfiguration,
  provideCopilotKit,
} from "@copilotkit/angular";
import type {
  ActivityRenderer,
  RenderActivityMessageConfig,
} from "@copilotkit/angular";
import {
  GENERATIVE_UI_AGENT_FUNCTION_CALLS,
  GENERATIVE_UI_FUNCTION_CALL_ACTIVITY_TYPE,
  generativeUIFunctionCallMessageId,
} from "@copilotkit/shared";
import type { GenerativeUIFunctionCallContent } from "@copilotkit/shared";
import { createGenerativeUI } from "../catalog";
import type { GenerativeUIConfig } from "../config";
import { provideGenerativeUI } from "../provide";
import { registerGenerativeUIFunction } from "../state";

// The functions that the agent calls with `callRendererFunction`, in both
// transports. The agent path is off for now
// (GENERATIVE_UI_AGENT_FUNCTION_CALLS), so these are skipped.

/** A controllable agent that records the input of each run. */
class CapturingAgent extends AbstractAgent {
  static inputs: RunAgentInput[] = [];
  readonly #subject = new Subject<BaseEvent>();
  input: RunAgentInput | undefined;

  constructor(id: string) {
    super({ agentId: id });
  }

  override run(input: RunAgentInput): Observable<BaseEvent> {
    CapturingAgent.inputs.push(input);
    this.input = input;
    return this.#subject.pipe(
      takeWhile(
        (event) =>
          event.type !== EventType.RUN_FINISHED &&
          event.type !== EventType.RUN_ERROR,
        true,
      ),
    );
  }

  emit(event: BaseEvent) {
    if (event.type === EventType.RUN_STARTED) this.isRunning = true;
    if (
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    ) {
      this.isRunning = false;
    }
    this.#subject.next(event);
  }

  start() {
    this.emit({ type: EventType.RUN_STARTED, ...this.#ids() } as BaseEvent);
  }

  finish() {
    this.emit({ type: EventType.RUN_FINISHED, ...this.#ids() } as BaseEvent);
  }

  #ids() {
    return { threadId: this.input?.threadId, runId: this.input?.runId };
  }

  override async detachActiveRun(): Promise<void> {}
}

@Component({
  selector: "test-button",
  template: `
    <button>{{ label() }}</button>
  `,
})
class Button {
  readonly label = input<string>();
}

const ui = createGenerativeUI({
  id: "shop",
  functions: {
    addToCart: {
      parameters: z.object({ sku: z.string() }),
      allowedCallers: "rendererOrAgent",
    },
  },
  components: {
    Button: { component: Button, props: z.object({ label: z.string() }) },
  },
});

type AddToCartHandler = (args: { sku: string }) => unknown;

/** Mounts a handler for addToCart, as a component would. */
function mountAddToCart(handler: AddToCartHandler) {
  const injector = createEnvironmentInjector(
    [],
    TestBed.inject(EnvironmentInjector),
  );
  registerGenerativeUIFunction(ui, "addToCart", handler, { injector });
  return () => injector.destroy();
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

const activitySnapshot = (
  messageId: string,
  activityType: string,
  content: Record<string, unknown>,
): BaseEvent =>
  ({
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId,
    activityType,
    content,
  }) as BaseEvent;

const textChunk = (messageId: string, delta: string): BaseEvent =>
  ({ type: EventType.TEXT_MESSAGE_CHUNK, messageId, delta }) as BaseEvent;

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
        activitySnapshot(
          generativeUIFunctionCallMessageId(call.functionCallId),
          GENERATIVE_UI_FUNCTION_CALL_ACTIVITY_TYPE,
          { ...call },
        ),
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
      textChunk(messageId, `Adding it.\n${fence(calls.map(callLine))}`),
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
  const agent = new CapturingAgent("default");
  agent.setMessages(history);
  TestBed.configureTestingModule({
    providers: [
      provideCopilotKit({
        licenseKey: "ck_pub_000000000000000000000000",
        agents: { default: agent },
      }),
      provideGenerativeUI(transport.config),
    ],
  });
  const { core } = TestBed.inject(CopilotKit);
  for (const handler of handlers) mountAddToCart(handler);
  return { agent, core };
}

async function waitForRuns(count: number) {
  await vi.waitFor(() => expect(CapturingAgent.inputs).toHaveLength(count));
}

/** Adds a user message and starts a run. Resolves when the run started. */
async function startUserTurn(
  core: CopilotKit["core"],
  agent: CapturingAgent,
  userMessageId: string,
) {
  const runs = CapturingAgent.inputs.length;
  agent.addMessage({ id: userMessageId, role: "user", content: "add it" });
  void core.runAgent({ agent });
  await waitForRuns(runs + 1);
  agent.start();
}

/** One whole user turn whose only run sends `calls`. */
async function userTurnWithCalls(
  transport: Transport,
  core: CopilotKit["core"],
  agent: CapturingAgent,
  calls: GenerativeUIFunctionCallContent[],
) {
  await startUserTurn(core, agent, "u1");
  transport.emitCalls(agent, "m1", calls);
  agent.finish();
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

// The agent path is off for now (GENERATIVE_UI_AGENT_FUNCTION_CALLS): the
// validator rejects every callRendererFunction. These describe the path for
// when it is on.
const describeAgentCalls = GENERATIVE_UI_AGENT_FUNCTION_CALLS
  ? describe
  : describe.skip;

describeAgentCalls.each([toolTransport, markdownTransport])(
  "agent-called functions ($name transport)",
  (transport) => {
    it("runs the call once and sends its result as a developer message in one follow-up run", async () => {
      const handler = vi.fn(({ sku }: { sku: string }) => ({ added: sku }));
      const { agent, core } = setup(transport, [handler]);

      await userTurnWithCalls(transport, core, agent, [
        addToCart("f1", { sku: "p1" }),
      ]);

      await waitForRuns(2);
      expect(handler).toHaveBeenCalledExactlyOnceWith({ sku: "p1" });
      expect(developerContents(CapturingAgent.inputs[1])).toEqual([
        '{"version":"v1.0","rendererFunctionResponse":{"functionCallId":"f1","value":{"added":"p1"}}}',
      ]);
    });

    it("answers a handler that returns nothing with a null value", async () => {
      const { agent, core } = setup(transport, [() => undefined]);

      await userTurnWithCalls(transport, core, agent, [
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
        const { agent, core } = setup(transport, handlers);

        await userTurnWithCalls(transport, core, agent, [
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
      const { agent, core } = setup(transport, [handler]);

      await userTurnWithCalls(transport, core, agent, [
        addToCart("f1", { sku: "a" }),
        addToCart("f2", { sku: "b" }),
      ]);

      await waitForRuns(2);
      expect(developerContents(CapturingAgent.inputs[1])).toEqual([
        '{"version":"v1.0","rendererFunctionResponse":{"functionCallId":"f1","value":"a"}}',
        '{"version":"v1.0","rendererFunctionResponse":{"functionCallId":"f2","value":"b"}}',
      ]);
      agent.start();
      agent.finish();
      await core.waitForPendingFrameworkUpdates();
      expect(CapturingAgent.inputs).toHaveLength(2);
    });

    it("waits for the run to finish before it answers", async () => {
      const handler = vi.fn(() => "ok");
      const { agent, core } = setup(transport, [handler]);
      await startUserTurn(core, agent, "u1");

      transport.emitCalls(agent, "m1", [addToCart("f1", { sku: "p1" })]);
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
      await core.waitForPendingFrameworkUpdates();

      expect(answers(agent)).toEqual([]);
      expect(CapturingAgent.inputs).toHaveLength(1);

      agent.finish();
      await waitForRuns(2);
      expect(answers(agent)).toHaveLength(1);
    });

    it("does not run a call again when the same messages are read again", async () => {
      const handler = vi.fn(() => "ok");
      const { agent, core } = setup(transport, [handler]);
      await userTurnWithCalls(transport, core, agent, [
        addToCart("f1", { sku: "p1" }),
      ]);
      await waitForRuns(2);
      agent.start();
      agent.finish();

      // A replay: the same messages arrive again.
      agent.setMessages([...agent.messages]);
      await core.waitForPendingFrameworkUpdates();

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
      const { agent, core } = setup(transport, [handler], history);

      await startUserTurn(core, agent, "u1");
      agent.finish();

      await waitForRuns(2);
      expect(handler).toHaveBeenCalledExactlyOnceWith({ sku: "new" });
      expect(developerContents(CapturingAgent.inputs[1]).at(-1)).toBe(
        '{"version":"v1.0","rendererFunctionResponse":{"functionCallId":"f2","value":"new"}}',
      );
    });

    it("starts at most 5 follow-up runs in one user turn, then answers with follow_up_limit", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const handler = vi.fn(() => "ok");
      const { agent, core } = setup(transport, [handler]);
      await startUserTurn(core, agent, "u1");

      // Run 1 is the user run. Runs 2 to 6 are the 5 follow-up runs.
      for (let run = 1; run <= 6; run++) {
        if (run > 1) {
          await waitForRuns(run);
          agent.start();
        }
        transport.emitCalls(agent, `m${run}`, [
          addToCart(`f${run}`, { sku: "p1" }),
        ]);
        agent.finish();
      }

      await vi.waitFor(() => expect(answers(agent)).toHaveLength(6));
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
      await core.waitForPendingFrameworkUpdates();
      expect(CapturingAgent.inputs).toHaveLength(6);

      // A new user message starts a new user turn.
      await startUserTurn(core, agent, "u2");
      transport.emitCalls(agent, "m7", [addToCart("f7", { sku: "p1" })]);
      agent.finish();
      await waitForRuns(8);
      expect(handler).toHaveBeenCalledTimes(6);
    });
  },
);

describeAgentCalls("agent-called functions, markdown transport only", () => {
  it("answers a call line with a wrong shape with invalid_arguments and the reason", async () => {
    const handler = vi.fn();
    const { agent, core } = setup(markdownTransport, [handler]);
    await startUserTurn(core, agent, "u1");

    agent.emit(
      textChunk(
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
    agent.finish();

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

  it("answers a call of a built-in with invalid_function_call: they run only in the UI", async () => {
    const { agent, core } = setup(markdownTransport, [vi.fn()]);
    await startUserTurn(core, agent, "u1");

    agent.emit(
      textChunk(
        "m1",
        fence([
          callLine({
            functionCallId: "f1",
            callFunction: { "@call": "formatNumber", args: { value: 1 } },
          }),
        ]),
      ),
    );
    agent.finish();

    await waitForRuns(2);
    expect(answers(agent)).toEqual([
      {
        version: "v1.0",
        rendererFunctionResponse: {
          functionCallId: "f1",
          error: {
            code: "invalid_function_call",
            message:
              'function "formatNumber" runs only in the UI (allowedCallers "rendererOnly"); the agent cannot call it',
          },
        },
      },
    ]);
  });
});

/** A wildcard renderer shows every activity that has no renderer of its own. */
@Component({
  selector: "test-wildcard-activity",
  template: `
    <div data-testid="wildcard-activity"></div>
  `,
})
class WildcardActivity implements ActivityRenderer<unknown> {
  readonly activityType = input.required<string>();
  readonly content = input.required<unknown>();
  readonly message = input.required<ActivityMessage>();
  readonly agent = input<AbstractAgent | undefined>();
}

const wildcardRenderers: RenderActivityMessageConfig[] = [
  { activityType: "*", content: z.unknown(), component: WildcardActivity },
];

describeAgentCalls("agent-called functions in the chat", () => {
  const T = "thread-1";

  beforeEach(() => {
    // The chat sticks to the bottom; jsdom has no scrollTo.
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: () => undefined,
    });
  });

  function setupChat(transport: Transport) {
    CapturingAgent.inputs = [];
    const agent = new CapturingAgent("default");
    const handler = vi.fn(() => "ok");
    TestBed.configureTestingModule({
      imports: [CopilotChat],
      providers: [
        provideCopilotKit({
          licenseKey: "ck_pub_000000000000000000000000",
          agents: { default: agent },
          renderActivityMessages: wildcardRenderers,
        }),
        provideGenerativeUI(transport.config),
        provideCopilotChatConfiguration({ agentId: "default", threadId: T }),
      ],
    });
    const { core } = TestBed.inject(CopilotKit);
    mountAddToCart(handler);
    const fixture = TestBed.createComponent(CopilotChat);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const detect = () => {
      fixture.detectChanges();
      fixture.detectChanges();
    };
    return { agent, core, handler, element, detect };
  }

  it.each([toolTransport, markdownTransport])(
    "shows nothing for the call and its answer ($name transport)",
    async (transport) => {
      const { agent, core, handler, element, detect } = setupChat(transport);
      await startUserTurn(core, agent, "u1");
      agent.emit(textChunk("m0", "Sure."));
      transport.emitCalls(agent, "m1", [addToCart("f1", { sku: "p1" })]);
      agent.finish();

      await waitForRuns(2);
      detect();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(element.textContent).toContain("Sure.");
      expect(
        element.querySelector("[data-testid=wildcard-activity]"),
      ).toBeNull();
      expect(element.textContent).not.toMatch(/callRendererFunction/);
      expect(element.textContent).not.toMatch(/rendererFunctionResponse/);
      expect(
        element.querySelectorAll("[data-generative-ui-chat-surface]"),
      ).toHaveLength(0);
      agent.start();
      agent.finish();
    },
  );
});
