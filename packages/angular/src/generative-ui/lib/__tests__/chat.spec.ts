import { Component, effect, input } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { ComponentFixture } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Subject, takeWhile } from "rxjs";
import type { Observable } from "rxjs";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { z } from "zod";
import {
  CopilotChat,
  CopilotKit,
  provideCopilotChatConfiguration,
  provideCopilotKit,
} from "@copilotkit/angular";
import type {
  A2UIComponentNode,
  GenerativeUIRejectedOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import type { ManagedSurface } from "@copilotkit/core/generative-ui";
import { createGenerativeUI } from "../catalog";
import { CopilotGenerativeUIActivityRenderer } from "../chat";
import { provideGenerativeUI } from "../provide";
import { GENERATIVE_UI_RUNTIME } from "../runtime";
import { createTestRuntime } from "./render";

@Component({
  selector: "test-row",
  template: `
    <p data-row>{{ text() }}</p>
  `,
})
class Row {
  readonly text = input<string>();
}

const ui = createGenerativeUI({
  id: "chat/ui@1",
  components: {
    Row: { component: Row, props: z.object({ text: z.string() }) },
  },
});

function content(
  surfaceId: string,
  target: string,
): GenerativeUISurfaceContent {
  const components: A2UIComponentNode[] = [
    { id: "root", component: "Row", text: "Hi" },
  ];
  return {
    surfaceId,
    target,
    catalogId: ui.id,
    operations: [
      { version: "v1.0", createSurface: { surfaceId, catalogId: ui.id } },
      { version: "v1.0", updateComponents: { surfaceId, components } },
    ],
    status: "ready",
    rejected: [],
  };
}

function render(activity: GenerativeUISurfaceContent) {
  const { runtime } = createTestRuntime(ui);
  TestBed.configureTestingModule({
    providers: [{ provide: GENERATIVE_UI_RUNTIME, useValue: runtime }],
  });
  const fixture = TestBed.createComponent(CopilotGenerativeUIActivityRenderer);
  fixture.componentRef.setInput("activityType", "generative-ui-surface");
  fixture.componentRef.setInput("content", activity);
  fixture.componentRef.setInput("message", { id: "m1", role: "activity" });
  fixture.componentRef.setInput("agent", {
    threadId: "t1",
    agentId: "default",
  } as unknown as AbstractAgent);
  fixture.detectChanges();
  fixture.detectChanges();
  return { fixture, element: fixture.nativeElement as HTMLElement, runtime };
}

// The chat card itself (render, error note) is covered below, through the
// chat; this is the one case the chat tests do not reach.
describe("CopilotGenerativeUIActivityRenderer", () => {
  it("renders nothing in the chat for a surface of a named target", () => {
    const { element, runtime } = render(content("s2", "side"));
    expect(runtime.manager.getSurface("t1", "s2")).toBeDefined();
    expect(
      element.querySelector("[data-generative-ui-chat-surface]"),
    ).toBeNull();
  });
});

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
  selector: "test-card",
  template: `
    <div [attr.data-testid]="'card-' + productId()">{{ name() }}</div>
  `,
})
class Card {
  readonly productId = input<string>();
  readonly name = input<string>();
}

const shopUI = createGenerativeUI({
  id: "shop",
  components: {
    Card: {
      component: Card,
      props: z.object({ productId: z.string(), name: z.string() }),
    },
  },
});

const T = "thread-1";
const create = (surfaceId: string) => ({
  version: "v1.0",
  createSurface: { surfaceId, catalogId: "shop" },
});
const nodes = (surfaceId: string, ...components: unknown[]) => ({
  version: "v1.0",
  updateComponents: { surfaceId, components },
});
const snapshot = (
  surfaceId: string,
  target: string,
  operations: unknown[],
): BaseEvent =>
  ({
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: `genui:${surfaceId}`,
    activityType: "generative-ui-surface",
    content: {
      surfaceId,
      target,
      catalogId: "shop",
      operations,
      status: "streaming",
      rejected: [],
    },
    replace: true,
  }) as BaseEvent;
const patch = (surfaceId: string, ...ops: unknown[]): BaseEvent =>
  ({
    type: EventType.ACTIVITY_DELTA,
    messageId: `genui:${surfaceId}`,
    activityType: "generative-ui-surface",
    patch: ops,
  }) as BaseEvent;
const card = (id: string) => ({
  id,
  component: "Card",
  productId: id,
  name: `Product ${id}`,
});

/** What a custom chat card saw. */
const seen: unknown[] = [];

@Component({
  selector: "test-wrapper",
  template: `
    <div data-testid="custom-wrapper"></div>
  `,
})
class Wrapper {
  readonly surface = input.required<ManagedSurface>();
  readonly surfaceId = input.required<string>();
  readonly isStreaming = input(false);
  readonly error = input<Error | undefined>();
  readonly rejected = input<GenerativeUIRejectedOperation[]>([]);
  constructor() {
    effect(() => {
      seen.push({ cause: this.error()?.cause, rejected: this.rejected() });
    });
  }
}

describe("generative UI integration: the chat card", () => {
  beforeEach(() => {
    // The chat sticks to the bottom; jsdom has no scrollTo.
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: () => undefined,
    });
  });

  function setupChat(chatCard?: typeof Wrapper) {
    CapturingAgent.inputs = [];
    seen.length = 0;
    const agent = new CapturingAgent("default");
    TestBed.configureTestingModule({
      imports: [CopilotChat],
      providers: [
        provideCopilotKit({
          licenseKey: "ck_pub_000000000000000000000000",
          agents: { default: agent },
        }),
        provideGenerativeUI({ ui: shopUI, chatCard }),
        provideCopilotChatConfiguration({ agentId: "default", threadId: T }),
      ],
    });
    const { core } = TestBed.inject(CopilotKit);
    const fixture: ComponentFixture<CopilotChat> =
      TestBed.createComponent(CopilotChat);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const detect = () => {
      fixture.detectChanges();
      fixture.detectChanges();
    };
    let turn = 0;
    /**
     * Sends `text` and lets the agent reply with `emit` between the run
     * start and its end, as the user would from the composer.
     */
    const send = async (text: string, emit: () => void) => {
      const index = CapturingAgent.inputs.length;
      agent.addMessage({ id: `u${++turn}`, role: "user", content: text });
      const pending = core.runAgent({ agent });
      await vi.waitFor(() =>
        expect(CapturingAgent.inputs.length).toBeGreaterThan(index),
      );
      agent.start();
      emit();
      agent.finish();
      await pending;
      detect();
    };
    const cardEl = () =>
      element.querySelector<HTMLElement>(
        '[data-generative-ui-chat-surface="cmp"]',
      );
    return { agent, element, detect, send, cardEl };
  }

  it("renders chat-targeted surfaces in the transcript with the default card", async () => {
    const { agent, element, send, cardEl } = setupChat();
    await send("compare", () => {
      agent.emit(
        snapshot("cmp", "chat", [create("cmp"), nodes("cmp", card("root"))]),
      );
    });
    expect(cardEl()?.textContent).toContain("Product root");
    expect(element.querySelectorAll("[data-testid=card-root]")).toHaveLength(1);
  });

  it("shows a friendly chat-card error only while the latest call has rejections", async () => {
    const { agent, send, cardEl } = setupChat();
    // Turn 1: the server rejected op 2, and op 1 fails client-side (unknown component).
    await send("compare", () => {
      agent.emit(
        snapshot("cmp", "chat", [
          create("cmp"),
          nodes("cmp", { id: "x", component: "Nope" }),
        ]),
      );
      agent.emit(
        patch(
          "cmp",
          {
            op: "add",
            path: "/rejected/-",
            value: {
              index: 2,
              reason: 'component "p3": unknown prop "category"',
            },
          },
          { op: "replace", path: "/status", value: "ready" },
        ),
      );
    });
    expect(cardEl()!.querySelector("[role=alert]")?.textContent?.trim()).toBe(
      "Part of this UI couldn't be shown.",
    );
    expect(cardEl()!.textContent).not.toContain("category");

    // Turn 2: the model repairs the card; the runtime resets status and rejected.
    await send("fix it", () => {
      agent.emit(
        patch(
          "cmp",
          { op: "replace", path: "/status", value: "streaming" },
          { op: "replace", path: "/rejected", value: [] },
          {
            op: "add",
            path: "/operations/-",
            value: nodes("cmp", card("root")),
          },
        ),
      );
      agent.emit(
        patch("cmp", { op: "replace", path: "/status", value: "ready" }),
      );
    });
    expect(cardEl()!.textContent).toContain("Product root");
    expect(cardEl()!.querySelector("[role=alert]")).toBeNull();
  });

  it("shows the chat-card error when the createSurface itself is rejected", async () => {
    const { agent, send, cardEl } = setupChat();
    await send("compare", () => {
      agent.emit(
        snapshot("cmp", "chat", [
          {
            version: "v1.0",
            createSurface: {
              surfaceId: "cmp",
              catalogId: "shop",
              components: [{ id: "root", component: "Nope" }],
            },
          },
        ]),
      );
    });
    expect(cardEl()!.querySelector("[role=alert]")?.textContent?.trim()).toBe(
      "Part of this UI couldn't be shown.",
    );
  });

  it("passes the raw rejection list to a custom chat card", async () => {
    const { agent, element, send } = setupChat(Wrapper);
    const reason = 'component "p3": unknown prop "category"';
    await send("compare", () => {
      agent.emit(snapshot("cmp", "chat", [create("cmp")]));
      agent.emit(
        patch("cmp", {
          op: "add",
          path: "/rejected/-",
          value: { index: 1, reason },
        }),
      );
    });
    const expected = [{ index: 1, reason }];
    expect(
      element.querySelector("[data-testid=custom-wrapper]"),
    ).not.toBeNull();
    expect(seen.at(-1)).toEqual({ cause: expected, rejected: expected });
  });
});
