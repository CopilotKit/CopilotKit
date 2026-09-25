import {
  ChangeDetectionStrategy,
  Component,
  input,
  provideZonelessChangeDetection,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, test, expect, vi } from "vitest";
import { By } from "@angular/platform-browser";
import { CopilotKit } from "../../../copilotkit";
import { CopilotChatInput } from "../copilot-chat-input";
import { Observable, Subject } from "rxjs";
import {
  AbstractAgent,
  AGUIConnectNotImplementedError,
  EventType,
  HttpAgent,
} from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { Attachment } from "@copilotkit/shared";
import { CopilotChat } from "../copilot-chat";
import { provideCopilotKit } from "../../../config";
import {
  injectChatConfiguration,
  provideCopilotChatConfiguration,
} from "../../../chat-configuration";
import type { CopilotChatConfiguration } from "../../../chat-configuration";

@Component({
  selector: "test-assistant-message",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p data-testid="custom-assistant">{{ message().content }}</p>
  `,
})
class TestAssistantMessage {
  readonly message = input.required<{ content?: string }>();
}

@Component({
  selector: "test-reasoning-message",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p data-testid="custom-reasoning">{{ message().content }}</p>
  `,
})
class TestReasoningMessage {
  readonly message = input.required<{ content?: string }>();
}

@Component({
  selector: "test-transcript-children",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p data-testid="transcript-children">
      {{ messages().length }} messages {{ state()["phase"] }}
    </p>
  `,
})
class TestTranscriptChildren {
  readonly messages = input<unknown[]>([]);
  readonly state = input<Record<string, unknown>>({});
}

/**
 * Agent stub for configuration and renderer tests.
 */
class MockAgent extends AbstractAgent {
  constructor(id: string) {
    super({ agentId: id });
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>();
  }
}

/**
 * Renders {@link CopilotChat} under an ambient
 * {@link CopilotChatConfiguration} plus a registered default agent.
 *
 * @returns The rendered fixture, the chat configuration service, and a
 *   query helper for the welcome screen.
 */
function createChatFixture(agent: AbstractAgent = new MockAgent("default")) {
  TestBed.configureTestingModule({
    teardown: { destroyAfterEach: true },
    imports: [CopilotChat],
    providers: [
      provideZonelessChangeDetection(),
      provideCopilotKit({
        licenseKey: "ck_pub_00000000000000000000000000000000",
        agents: { default: agent },
      }),
      provideCopilotChatConfiguration(),
    ],
  });

  const config = TestBed.runInInjectionContext(() =>
    injectChatConfiguration(),
  ) as CopilotChatConfiguration;

  const fixture = TestBed.createComponent(CopilotChat);
  fixture.detectChanges();

  const welcomeScreen = () =>
    (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="copilot-welcome-screen"]',
    );

  return {
    fixture,
    config,
    welcomeScreen,
    chat: fixture.componentInstance,
    core: TestBed.inject(CopilotKit).core,
  };
}

/**
 * Renders {@link CopilotChat} with a custom config {@link agentId} and
 * optional component input overrides, registering an agent for every id used.
 *
 * @param configAgentId - The agent id passed to {@link provideCopilotChatConfiguration}.
 * @param componentAgentId - Optional `[agentId]` input bound on the component.
 * @param componentThreadId - Optional `[threadId]` input bound on the component.
 * @returns The rendered fixture and a helper to read the resolved agent id.
 */
function createConfiguredChatFixture({
  configAgentId,
  componentAgentId,
  componentThreadId,
  configThreadId,
}: {
  configAgentId: string;
  componentAgentId?: string;
  componentThreadId?: string;
  configThreadId?: string;
}) {
  // Register an agent for every id in play so injectAgentStore never throws.
  const agentIds = Array.from(
    new Set(
      [configAgentId, componentAgentId, "default"].filter(
        (id): id is string => id !== undefined,
      ),
    ),
  );
  const agents = Object.fromEntries(
    agentIds.map((id) => [id, new MockAgent(id)]),
  );

  TestBed.configureTestingModule({
    teardown: { destroyAfterEach: true },
    imports: [CopilotChat],
    providers: [
      provideZonelessChangeDetection(),
      provideCopilotKit({
        licenseKey: "ck_pub_00000000000000000000000000000000",
        agents,
      }),
      provideCopilotChatConfiguration({
        agentId: configAgentId,
        ...(configThreadId !== undefined ? { threadId: configThreadId } : {}),
      }),
    ],
  });

  const config = TestBed.runInInjectionContext(() =>
    injectChatConfiguration(),
  ) as CopilotChatConfiguration;

  const fixture = TestBed.createComponent(CopilotChat);

  if (componentAgentId !== undefined) {
    fixture.componentRef.setInput("agentId", componentAgentId);
  }
  if (componentThreadId !== undefined) {
    fixture.componentRef.setInput("threadId", componentThreadId);
  }

  fixture.detectChanges();

  /** Returns the agent id of the resolved agent store's agent. */
  const resolvedAgentId = () =>
    fixture.componentInstance.agentStore().agent.agentId;

  /** Returns true when the component's hasExplicitThreadId signal is true. */
  const isThreadExplicit = () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fixture.componentInstance as any)["hasExplicitThreadId"]();

  /** Returns the threadId pinned onto the resolved agent. */
  const agentThreadId = () =>
    fixture.componentInstance.agentStore().agent.threadId;

  return { fixture, config, resolvedAgentId, isThreadExplicit, agentThreadId };
}

/**
 * Reads the component's loading cursor binding.
 */
function readShowCursor(fixture: { componentInstance: CopilotChat }): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (fixture.componentInstance as any)["showCursor"]() as boolean;
}

class StreamingAgent extends AbstractAgent {
  readonly connection = new Subject<BaseEvent>();
  output = new Subject<BaseEvent>();
  connects = 0;
  readonly inputs: RunAgentInput[] = [];
  constructor() {
    super({ agentId: "default" });
  }
  protected override connect() {
    this.connects++;
    return this.connection;
  }
  run(input: RunAgentInput) {
    this.output = new Subject<BaseEvent>();
    this.inputs.push(input);
    return this.output;
  }
  finish() {
    const input = this.inputs.at(-1)!;
    this.output.next({
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    });
    this.output.next({
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
    });
    this.output.complete();
  }
}

class ConnectedHttpAgent extends HttpAgent {
  readonly connection = new Subject<BaseEvent>();
  connects = 0;
  constructor() {
    super({ agentId: "default", url: "/agent" });
  }
  protected override connect() {
    this.connects++;
    return this.connection;
  }
}

const readyAttachment: Attachment = {
  id: "photo",
  type: "image",
  status: "ready",
  source: {
    type: "url",
    value: "https://example.com/photo.png",
    mimeType: "image/png",
  },
};

describe("CopilotChat", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: () => undefined,
    });
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  describe("configuration and welcome", () => {
    describe("welcome state", () => {
      let context: ReturnType<typeof createChatFixture>;
      beforeEach(() => {
        context = createChatFixture();
      });

      test("shows the welcome screen while the configuration thread is non-explicit", () => {
        const { config, welcomeScreen } = context;

        expect(config.hasExplicitThreadId()).toBe(false);
        expect(welcomeScreen()).not.toBeNull();
      });

      test("hides the welcome screen once the configuration activates an explicit thread", () => {
        const { config, welcomeScreen } = context;

        config.setActiveThreadId("x");
        TestBed.tick();

        expect(config.hasExplicitThreadId()).toBe(true);
        expect(welcomeScreen()).toBeNull();
      });
    });

    test("component [agentId] input wins over ambient config agentId", () => {
      const { resolvedAgentId } = createConfiguredChatFixture({
        configAgentId: "cfg-agent",
        componentAgentId: "input-agent",
      });

      expect(resolvedAgentId()).toBe("input-agent");
    });

    test("config agentId drives resolution when component [agentId] is not set", () => {
      const { resolvedAgentId } = createConfiguredChatFixture({
        configAgentId: "cfg-agent",
      });

      expect(resolvedAgentId()).toBe("cfg-agent");
    });

    test("[threadId] input drives the config thread and agent under an uncontrolled config", () => {
      const { config, isThreadExplicit, agentThreadId } =
        createConfiguredChatFixture({
          configAgentId: "cfg-agent",
          componentThreadId: "t1",
        });

      TestBed.tick();

      expect(config.threadId()).toBe("t1");
      expect(agentThreadId()).toBe("t1");
      expect(isThreadExplicit()).toBe(true);
    });

    test("a controlled config thread wins over the [threadId] input (input ignored)", () => {
      const { config, agentThreadId } = createConfiguredChatFixture({
        configAgentId: "cfg-agent",
        configThreadId: "cfg-thread",
        componentThreadId: "t1",
      });

      TestBed.tick();

      expect(config.threadId()).toBe("cfg-thread");
      expect(agentThreadId()).toBe("cfg-thread");
    });
  });

  describe("message rendering", () => {
    let agent: MockAgent;
    let context: ReturnType<typeof createChatFixture>;
    beforeEach(() => {
      agent = new MockAgent("default");
      context = createChatFixture(agent);
    });

    test("forwards a custom assistant-message component through the prebuilt chat", async () => {
      const { fixture } = context;
      fixture.componentRef.setInput(
        "assistantMessageComponent",
        TestAssistantMessage,
      );
      fixture.detectChanges();
      agent.setMessages([
        {
          id: "assistant-1",
          role: "assistant",
          content: "Rendered by the application",
        },
      ]);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();

      const customMessage = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLElement>('[data-testid="custom-assistant"]');

      expect(customMessage?.textContent).toBe("Rendered by the application");
    });

    test("forwards a custom reasoning-message component through the prebuilt chat", async () => {
      const { fixture } = context;
      fixture.componentRef.setInput(
        "reasoningMessageComponent",
        TestReasoningMessage,
      );
      fixture.detectChanges();
      agent.setMessages([
        {
          id: "reasoning-1",
          role: "reasoning",
          content: "Rendered reasoning",
        },
      ]);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();

      const customMessage = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLElement>('[data-testid="custom-reasoning"]');

      expect(customMessage?.textContent).toBe("Rendered reasoning");
    });

    test("forwards transcript children through the prebuilt chat", async () => {
      const { fixture } = context;
      fixture.componentRef.setInput(
        "messageViewChildrenComponent",
        TestTranscriptChildren,
      );
      fixture.detectChanges();
      agent.setMessages([
        { id: "user-1", role: "user", content: "Plan a launch" },
      ]);
      agent.setState({ phase: "streamed" });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();

      const children = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLElement>('[data-testid="transcript-children"]');
      expect(children?.textContent).toContain("1 messages");
      expect(children?.textContent).toContain("streamed");
    });
  });

  describe("sending messages", () => {
    let agent: StreamingAgent;
    let context: ReturnType<typeof createChatFixture>;
    beforeEach(() => {
      agent = new StreamingAgent();
      context = createChatFixture(agent);
    });

    test("Enter clears the composer and defers its message and attachments until the active run finishes", async () => {
      const { fixture, chat, core } = context;
      const external = core.runAgent({ agent });
      await vi.waitFor(() => expect(agent.inputs).toHaveLength(1));
      const detach = vi.spyOn(agent, "detachActiveRun");
      const submit = vi.spyOn(chat, "submitInput");
      chat.attachments.set([readyAttachment]);
      chat.changeInput("look at this");
      fixture.detectChanges();
      const input = fixture.debugElement.query(By.directive(CopilotChatInput))
        .componentInstance as CopilotChatInput;
      input.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter" }));
      const queued = submit.mock.results[0]!.value as Promise<void>;
      expect(chat.inputValue()).toBe("");
      expect(chat.attachments()).toEqual([readyAttachment]);
      expect(agent.messages).toEqual([]);
      expect(detach).not.toHaveBeenCalled();
      expect(input.textAreaContext().disabled).toBe(false);

      chat.changeInput("next draft");
      agent.finish();
      await external;
      await vi.waitFor(() => expect(agent.inputs).toHaveLength(2));
      expect(chat.attachments()).toEqual([]);
      expect(chat.inputValue()).toBe("next draft");
      expect(agent.messages).toHaveLength(1);
      expect(agent.messages[0]).toMatchObject({
        role: "user",
        content: [
          { type: "text", text: "look at this" },
          { type: "image", source: readyAttachment.source },
        ],
      });
      agent.finish();
      await queued;
    });

    test("a suggestion waits for an active run and leaves the composer and attachments alone", async () => {
      const { chat, core } = context;
      const external = core.runAgent({ agent });
      await vi.waitFor(() => expect(agent.inputs).toHaveLength(1));
      const detach = vi.spyOn(agent, "detachActiveRun");
      chat.changeInput("keep my draft");
      chat.attachments.set([readyAttachment]);
      const queued = chat.selectSuggestion(
        { title: "Next", message: "next turn", isLoading: false },
        0,
      );
      expect(agent.messages).toEqual([]);
      expect(detach).not.toHaveBeenCalled();
      agent.finish();
      await external;
      await vi.waitFor(() => expect(agent.inputs).toHaveLength(2));
      expect(agent.messages).toMatchObject([
        { role: "user", content: "next turn" },
      ]);
      expect(chat.inputValue()).toBe("keep my draft");
      expect(chat.attachments()).toEqual([readyAttachment]);
      agent.finish();
      await queued;
    });

    test("an upload started during the wait restores the submitted text and prevents dispatch", async () => {
      const { chat, core } = context;
      const external = core.runAgent({ agent });
      await vi.waitFor(() => expect(agent.inputs).toHaveLength(1));
      vi.spyOn(console, "error").mockImplementation(() => {});
      chat.changeInput("retain this");
      const queued = chat.submitInput("retain this");
      expect(chat.inputValue()).toBe("");
      chat.attachments.set([{ ...readyAttachment, status: "uploading" }]);
      agent.finish();
      await external;
      await queued;
      expect(agent.inputs).toHaveLength(1);
      expect(agent.messages).toEqual([]);
      expect(chat.inputValue()).toBe("retain this");
      expect(chat.attachments()[0]!.status).toBe("uploading");
    });

    test("an existing upload prevents accepting or clearing a typed message", async () => {
      const { chat, core } = context;
      const run = vi.spyOn(core, "runAgent");
      chat.attachments.set([{ ...readyAttachment, status: "uploading" }]);
      chat.changeInput("retain this");
      await chat.submitInput("retain this");
      expect(chat.inputValue()).toBe("retain this");
      expect(run).not.toHaveBeenCalled();
    });

    test("a rejected active completion does not prevent the next send", async () => {
      const { chat, core } = context;
      let reject!: (error: Error) => void;
      Object.defineProperty(agent, "activeRunCompletionPromise", {
        value: new Promise<void>((_resolve, no) => {
          reject = no;
        }),
        configurable: true,
      });
      agent.isRunning = true;
      vi.spyOn(console, "error").mockImplementation(() => {});
      const run = vi
        .spyOn(core, "runAgent")
        .mockResolvedValue({ result: undefined, newMessages: [] });
      const queued = chat.submitInput("next turn");
      expect(run).not.toHaveBeenCalled();
      reject(new Error("active run failed"));
      await queued;
      expect(run).toHaveBeenCalledOnce();
      expect(agent.messages).toMatchObject([{ content: "next turn" }]);
    });

    test("a deferred send is discarded when the thread changes during the wait", async () => {
      const { fixture, config, chat, core } = context;
      const run = vi.spyOn(core, "runAgent");
      const external = core.runAgent({ agent });
      await vi.waitFor(() => expect(agent.inputs).toHaveLength(1));
      const queued = chat.submitInput("stale thread");
      config.startNewThread();
      fixture.detectChanges();
      agent.finish();
      await external;
      await queued;
      expect(run).toHaveBeenCalledOnce();
      expect(agent.messages).toEqual([]);
    });

    test("a deferred send is discarded when the chat is destroyed during the wait", async () => {
      const { fixture, chat, core } = context;
      const run = vi.spyOn(core, "runAgent");
      const external = core.runAgent({ agent });
      await vi.waitFor(() => expect(agent.inputs).toHaveLength(1));
      const threadId = agent.threadId;
      const queued = chat.submitInput("destroyed");
      fixture.destroy();
      agent.finish();
      await external;
      await queued;
      expect(agent.threadId).toBe(threadId);
      expect(run).toHaveBeenCalledOnce();
      expect(agent.messages).toEqual([]);
    });

    test("a send after destroy is ignored and leaves the composer untouched", async () => {
      const { fixture, chat, core } = context;
      const run = vi.spyOn(core, "runAgent");
      chat.changeInput("after destroy");
      fixture.destroy();
      await chat.submitInput("after destroy");
      expect(run).not.toHaveBeenCalled();
      expect(chat.inputValue()).toBe("after destroy");
    });
  });

  describe("connection lifecycle", () => {
    describe("agent connections", () => {
      let agent: StreamingAgent;
      let context: ReturnType<typeof createChatFixture>;
      beforeEach(() => {
        agent = new StreamingAgent();
        context = createChatFixture(agent);
      });

      test("shows the cursor during connect and clears it when the connection settles", async () => {
        const { fixture, config } = context;
        config.setActiveThreadId("existing", { explicit: true });
        fixture.detectChanges();
        await vi.waitFor(() => expect(agent.connects).toBe(1));
        expect(readShowCursor(fixture)).toBe(true);
        agent.connection.complete();
        await vi.waitFor(() => expect(readShowCursor(fixture)).toBe(false));
      });

      test("a chat send waits for its active connection to finish, matching React", async () => {
        const { fixture, config, chat } = context;
        config.setActiveThreadId("existing", { explicit: true });
        fixture.detectChanges();
        await vi.waitFor(() => expect(agent.connects).toBe(1));
        expect(agent.isRunning).toBe(true);
        const sent = chat.submitInput("hello");
        expect(chat.inputValue()).toBe("");
        await Promise.resolve();
        expect(agent.inputs).toHaveLength(0);
        agent.connection.complete();
        await vi.waitFor(() => expect(agent.inputs).toHaveLength(1));
        agent.finish();
        await sent;
      });

      test("destroy does not detach a chat run that started after the connection finished", async () => {
        const { fixture, config, chat } = context;
        config.setActiveThreadId("existing", { explicit: true });
        fixture.detectChanges();
        await vi.waitFor(() => expect(agent.connects).toBe(1));
        agent.connection.complete();
        const sent = chat.submitInput("hello");
        await vi.waitFor(() => expect(agent.inputs).toHaveLength(1));
        const detach = vi.spyOn(agent, "detachActiveRun");
        fixture.destroy();
        expect(detach).not.toHaveBeenCalled();
        agent.finish();
        await sent;
      });

      test("a superseded connection settling late keeps the live connection owned", async () => {
        const { fixture, config } = context;
        config.setActiveThreadId("first", { explicit: true });
        fixture.detectChanges();
        await vi.waitFor(() => expect(agent.connects).toBe(1));
        config.setActiveThreadId("second", { explicit: true });
        fixture.detectChanges();
        await vi.waitFor(() => expect(agent.connects).toBe(2));
        // Let the first connection's settle handlers run.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(readShowCursor(fixture)).toBe(true);
        const detach = vi.spyOn(agent, "detachActiveRun");
        fixture.destroy();
        expect(detach).toHaveBeenCalledOnce();
      });

      test("destroy does not detach a run that replaced the connection's pipeline", async () => {
        const { fixture, config } = context;
        config.setActiveThreadId("existing", { explicit: true });
        fixture.detectChanges();
        await vi.waitFor(() => expect(agent.connects).toBe(1));
        // A run started directly on the agent takes over the pipeline without
        // Core detaching the connection first.
        const external = agent.runAgent();
        await vi.waitFor(() => expect(agent.inputs).toHaveLength(1));
        const detach = vi.spyOn(agent, "detachActiveRun");
        fixture.destroy();
        expect(detach).not.toHaveBeenCalled();
        agent.finish();
        await external;
      });

      test("destroying an owned connection detaches it once", async () => {
        const { fixture, config } = context;
        config.setActiveThreadId("existing", { explicit: true });
        fixture.detectChanges();
        await vi.waitFor(() => expect(agent.connects).toBe(1));
        const detach = vi.spyOn(agent, "detachActiveRun");
        fixture.destroy();
        await vi.waitFor(() => expect(agent.isRunning).toBe(false));
        expect(detach).toHaveBeenCalledOnce();
      });

      test("destroy before connect delegation does not call Core", async () => {
        const { fixture, config, core } = context;
        const connect = vi.spyOn(core, "connectAgent");
        config.setActiveThreadId("existing", { explicit: true });
        fixture.detectChanges();
        fixture.destroy();
        await Promise.resolve();
        expect(connect).not.toHaveBeenCalled();
      });
    });

    describe("connect errors", () => {
      let context: ReturnType<typeof createChatFixture>;
      beforeEach(() => {
        context = createChatFixture();
      });

      test("logs an unexpected connect failure", async () => {
        const { fixture, config, core } = context;
        const error = new Error("connect failed");
        vi.spyOn(core, "connectAgent").mockRejectedValue(error);
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        config.setActiveThreadId("existing", { explicit: true });
        fixture.detectChanges();
        await vi.waitFor(() =>
          expect(log).toHaveBeenCalledWith(
            "[CopilotKit] Failed to connect to agent:",
            error,
          ),
        );
        expect(readShowCursor(fixture)).toBe(false);
      });

      test("does not log when the agent does not implement connect", async () => {
        const { fixture, config, core } = context;
        const connect = vi
          .spyOn(core, "connectAgent")
          .mockRejectedValue(new AGUIConnectNotImplementedError());
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        config.setActiveThreadId("existing", { explicit: true });
        fixture.detectChanges();
        await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(readShowCursor(fixture)).toBe(false));
        expect(log).not.toHaveBeenCalled();
      });
    });

    test("switching threads aborts the previous HTTP connection", async () => {
      const agent = new ConnectedHttpAgent();
      const { fixture, config } = createChatFixture(agent);
      config.setActiveThreadId("first", { explicit: true });
      fixture.detectChanges();
      await vi.waitFor(() => expect(agent.connects).toBe(1));
      const first = agent.abortController;
      config.setActiveThreadId("second", { explicit: true });
      fixture.detectChanges();
      expect(first.signal.aborted).toBe(true);
      await vi.waitFor(() => expect(agent.connects).toBe(2));
      expect(agent.abortController).not.toBe(first);
      expect(agent.abortController.signal.aborted).toBe(false);
    });

    test("old HTTP connection cleanup does not abort a successor using the same controller", async () => {
      const agent = new ConnectedHttpAgent();
      const { fixture, config } = createChatFixture(agent);
      config.setActiveThreadId("existing", { explicit: true });
      fixture.detectChanges();
      await vi.waitFor(() => expect(agent.connects).toBe(1));
      const controller = agent.abortController;
      const successor = TestBed.inject(CopilotKit).core.connectAgent({ agent });
      await vi.waitFor(() => expect(agent.connects).toBe(2));
      const detach = vi.spyOn(agent, "detachActiveRun");
      fixture.destroy();
      expect(detach).not.toHaveBeenCalled();
      expect(agent.abortController).toBe(controller);
      expect(controller.signal.aborted).toBe(false);
      await agent.detachActiveRun();
      await successor;
    });
  });
});
