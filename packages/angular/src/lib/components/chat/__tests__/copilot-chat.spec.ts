import { provideZonelessChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { test, expect } from "vitest";
import { Observable } from "rxjs";
import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { CopilotChat } from "../copilot-chat";
import { provideCopilotKit } from "../../../config";
import {
  injectChatConfiguration,
  provideCopilotChatConfiguration,
  type CopilotChatConfiguration,
} from "../../../chat-configuration";

/**
 * Minimal agent stub: `injectAgentStore` resolves it from the configured
 * agents map and subscribes to it. Its `run` never emits, so connecting is a
 * no-op for the purposes of welcome-state assertions.
 */
class MockAgent extends AbstractAgent {
  constructor(id: string) {
    super();
    this.agentId = id;
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
function setup() {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: () => undefined,
  });

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CopilotChat],
    providers: [
      provideZonelessChangeDetection(),
      provideCopilotKit({
        licenseKey: "ck_pub_00000000000000000000000000000000",
        agents: { default: new MockAgent("default") },
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

  return { fixture, config, welcomeScreen };
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
function setupAgentPrecedence({
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
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: () => undefined,
  });

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

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
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

/** Reads the component's protected `showCursor` signal. */
function readShowCursor(fixture: { componentInstance: CopilotChat }): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (fixture.componentInstance as any)["showCursor"]() as boolean;
}

test("shows the loading cursor while the ambient config connects an explicit thread", () => {
  const { fixture, config } = setup();

  // The MockAgent's run Observable never emits, so the connect stays pending —
  // the cursor must remain on for the duration of the connect.
  config.setActiveThreadId("x", { explicit: true });
  TestBed.flushEffects();
  fixture.detectChanges();

  expect(readShowCursor(fixture)).toBe(true);
});

test("clears the loading cursor once the ambient-config connect settles", async () => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: () => undefined,
  });

  // An agent whose run completes immediately so the connect promise settles,
  // mirroring the standalone path that clears the cursor when connect settles.
  class CompletingAgent extends AbstractAgent {
    constructor(id: string) {
      super();
      this.agentId = id;
    }

    run(_input: RunAgentInput): Observable<BaseEvent> {
      return new Observable<BaseEvent>((subscriber) => {
        subscriber.complete();
      });
    }
  }

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CopilotChat],
    providers: [
      provideZonelessChangeDetection(),
      provideCopilotKit({
        licenseKey: "ck_pub_00000000000000000000000000000000",
        agents: { default: new CompletingAgent("default") },
      }),
      provideCopilotChatConfiguration(),
    ],
  });

  const config = TestBed.runInInjectionContext(() =>
    injectChatConfiguration(),
  ) as CopilotChatConfiguration;

  const fixture = TestBed.createComponent(CopilotChat);
  fixture.detectChanges();

  config.setActiveThreadId("x", { explicit: true });
  TestBed.flushEffects();

  // The agent teardown crosses a macrotask boundary that Angular does not own.
  // Poll the signal without forcing zone/effect ticks; this suite deliberately
  // exercises the same zoneless mode as the shipped Angular demo.
  for (let attempt = 0; attempt < 10 && readShowCursor(fixture); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  expect(readShowCursor(fixture)).toBe(false);
});

test("shows the welcome screen while the configuration thread is non-explicit", () => {
  const { config, welcomeScreen } = setup();

  expect(config.hasExplicitThreadId()).toBe(false);
  expect(welcomeScreen()).not.toBeNull();
});

test("hides the welcome screen once the configuration activates an explicit thread", () => {
  const { fixture, config, welcomeScreen } = setup();

  config.setActiveThreadId("x");
  TestBed.flushEffects();
  fixture.detectChanges();

  expect(config.hasExplicitThreadId()).toBe(true);
  expect(welcomeScreen()).toBeNull();
});

// ─── A1: component [agentId] input takes precedence over ambient config ───────

test("component [agentId] input wins over ambient config agentId", () => {
  const { resolvedAgentId } = setupAgentPrecedence({
    configAgentId: "cfg-agent",
    componentAgentId: "input-agent",
  });

  expect(resolvedAgentId()).toBe("input-agent");
});

test("config agentId drives resolution when component [agentId] is not set", () => {
  const { resolvedAgentId } = setupAgentPrecedence({
    configAgentId: "cfg-agent",
  });

  expect(resolvedAgentId()).toBe("cfg-agent");
});

// ─── A5: component [threadId] input seeds the ambient config ──────────────────

test("[threadId] input drives the config thread and agent under an uncontrolled config", () => {
  const { fixture, config, isThreadExplicit, agentThreadId } =
    setupAgentPrecedence({
      configAgentId: "cfg-agent",
      componentThreadId: "t1",
    });

  TestBed.flushEffects();
  fixture.detectChanges();

  expect(config.threadId()).toBe("t1");
  expect(agentThreadId()).toBe("t1");
  expect(isThreadExplicit()).toBe(true);
});

test("a controlled config thread wins over the [threadId] input (input ignored)", () => {
  const { fixture, config, agentThreadId } = setupAgentPrecedence({
    configAgentId: "cfg-agent",
    configThreadId: "cfg-thread",
    componentThreadId: "t1",
  });

  TestBed.flushEffects();
  fixture.detectChanges();

  expect(config.threadId()).toBe("cfg-thread");
  expect(agentThreadId()).toBe("cfg-thread");
});
