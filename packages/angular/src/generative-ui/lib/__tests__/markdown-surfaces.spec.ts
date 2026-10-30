import {
  Component,
  EnvironmentInjector,
  createEnvironmentInjector,
  input,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";
import { Subject, takeWhile } from "rxjs";
import type { Observable } from "rxjs";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/client";
import { z } from "zod";
import { CopilotKit, provideCopilotKit } from "@copilotkit/angular";
import {
  GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
  GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
  buildGenerativeUIMarkdownGuidelines,
} from "@copilotkit/shared";
import { getMarkdownSurfaceSource } from "@copilotkit/core/generative-ui";
import { createGenerativeUI } from "../catalog";
import { CopilotGenerativeUIChildren } from "../children.directive";
import type { GenerativeUIChildren } from "../children";
import type { GenerativeUIMarkdownConfig } from "../config";
import { CopilotGenerativeUIMarkdownSurfaces } from "../markdown-surfaces";
import { provideGenerativeUI } from "../provide";
import { GENERATIVE_UI_RUNTIME } from "../runtime";
import { registerGenerativeUIFunction } from "../state";
import { CopilotGenerativeUISurface } from "../surface";
import { createTestRuntime } from "./render";

// The rendering tests go through `CopilotGenerativeUIMarkdownSurfaces` with a
// stub runtime; the context tests go through the root with the markdown
// transport.

@Component({
  selector: "test-button",
  template: `
    <button>{{ label() }}</button>
  `,
})
class Button {
  readonly label = input<string>();
}

@Component({
  selector: "test-column",
  imports: [CopilotGenerativeUIChildren],
  template: `
    <div><ng-container *copilotGenerativeUIChildren="children()" /></div>
  `,
})
class Column {
  readonly children = input<GenerativeUIChildren>();
}

@Component({
  selector: "test-text",
  template: `
    <p data-testid="surface-text">{{ text() }}</p>
  `,
})
class Text {
  readonly text = input<string>();
}

const ui = createGenerativeUI({
  id: "shop",
  functions: {
    addToCart: { parameters: z.object({ sku: z.string() }) },
  },
  components: {
    Button: { component: Button, props: z.object({ label: z.string() }) },
    Column: { component: Column, slots: { children: "multiple" } },
    Text: { component: Text, props: z.object({ text: z.string() }) },
  },
});

const T = "thread-1";
const TARGET_DESCRIPTION = "Next to the product list.";

const create = (surfaceId: string) => ({
  version: "v1.0",
  createSurface: { surfaceId, catalogId: "shop" },
});
const buttonRoot = (surfaceId: string, label: string) => ({
  version: "v1.0",
  updateComponents: {
    surfaceId,
    components: [{ id: "root", component: "Button", label }],
  },
});

/** An a2ui fence with one operation per line. */
function fence(operations: object[], info = "") {
  const body = operations.map((op) => JSON.stringify(op)).join("\n");
  return `\`\`\`a2ui${info}\n${body}\n\`\`\`\n`;
}

const CHAT_SURFACE = "[data-generative-ui-chat-surface]";
const chatSurfaces = (root: ParentNode = document) =>
  root.querySelectorAll<HTMLElement>(CHAT_SURFACE);
const buttonText = (surface: Element) =>
  surface.querySelector("button")?.textContent?.trim();

/**
 * Renders the assistant messages of one thread with a stub runtime, each
 * with `CopilotGenerativeUIMarkdownSurfaces`. The messages are synced the
 * way the root syncs them.
 */
function renderMessages(
  messages: Message[],
  { running = false, withMessageId = true } = {},
) {
  const { runtime } = createTestRuntime(ui);
  runtime.transport = "markdown";
  runtime.manager.setActiveThread(T);
  const source = getMarkdownSurfaceSource(runtime);
  source.sync(T, "default", messages, { running });
  TestBed.configureTestingModule({
    providers: [{ provide: GENERATIVE_UI_RUNTIME, useValue: runtime }],
  });
  const fixtures = messages.map((message) => {
    const fixture = TestBed.createComponent(
      CopilotGenerativeUIMarkdownSurfaces,
    );
    fixture.componentRef.setInput("content", message.content ?? "");
    if (withMessageId) fixture.componentRef.setInput("messageId", message.id);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  });
  const elements = fixtures.map(
    (fixture) => fixture.nativeElement as HTMLElement,
  );
  /** More of the same messages arrived: syncs and renders them again. */
  const stream = (next: Message[], { running = false } = {}) => {
    source.sync(T, "default", next, { running });
    fixtures.forEach((fixture, index) => {
      fixture.componentRef.setInput("content", next[index]?.content ?? "");
      fixture.detectChanges();
      fixture.detectChanges();
    });
  };
  return { elements, element: elements[0]!, runtime, stream };
}

function render(content: string) {
  return renderMessages([{ id: "m1", role: "assistant", content }]);
}

@Component({
  imports: [CopilotGenerativeUISurface],
  template: `
    <section data-testid="inline">
      <copilot-generative-ui-surface
        id="recommendations"
        [description]="description"
      >
        <span>No recommendations yet</span>
      </copilot-generative-ui-surface>
    </section>
  `,
})
class InlineHost {
  description = TARGET_DESCRIPTION;
}

describe("CopilotGenerativeUIMarkdownSurfaces", () => {
  it("renders a fence as a surface in the message and the prose around it as markdown", () => {
    const content = `Here is **the offer**:\n\n${fence([create("s1"), buttonRoot("s1", "Buy")])}\nOutro paragraph.`;
    const { element } = render(content);
    const children = [...element.children];
    expect(children.map((child) => child.tagName.toLowerCase())).toEqual([
      "copilot-chat-assistant-message-renderer",
      "copilot-generative-ui-markdown-chat-surface",
      "copilot-chat-assistant-message-renderer",
    ]);
    expect(children[0]?.textContent).toContain("the offer");
    expect(children[0]?.querySelector("strong")?.textContent).toBe("the offer");
    expect(chatSurfaces(element)).toHaveLength(1);
    expect(chatSurfaces(element)[0]!.dataset.generativeUiChatSurface).toBe(
      "s1",
    );
    expect(buttonText(chatSurfaces(element)[0]!)).toBe("Buy");
    expect(children[2]?.textContent).toContain("Outro paragraph.");
    expect(element.textContent).not.toContain("createSurface");
  });

  it("renders the fence as code when it gets no message id", () => {
    const { element } = renderMessages(
      [
        {
          id: "m1",
          role: "assistant",
          content: fence([create("s1"), buttonRoot("s1", "Buy")]),
        },
      ],
      { withMessageId: false },
    );
    // Without the id, the fences of the message cannot be found, so the
    // fence stays visible instead of disappearing.
    expect(element.textContent).toContain("createSurface");
    expect(chatSurfaces(element)).toHaveLength(0);
  });

  it("shows nothing for a half-streamed fence until its root operation is complete", () => {
    const createLine = JSON.stringify(create("s1"));
    const rootLine = JSON.stringify(buttonRoot("s1", "Buy"));
    const half = `Hi\n\`\`\`a2ui\n${createLine}\n${rootLine.slice(0, 60)}`;
    const { element, stream } = renderMessages(
      [{ id: "m1", role: "assistant", content: half }],
      { running: true },
    );
    expect(chatSurfaces(element)).toHaveLength(0);
    expect(element.textContent).toContain("Hi");

    stream([
      {
        id: "m1",
        role: "assistant",
        content: `${half}${rootLine.slice(60)}\n\`\`\`\n`,
      },
    ]);
    expect(chatSurfaces(element)).toHaveLength(1);
    expect(buttonText(chatSurfaces(element)[0]!)).toBe("Buy");
  });

  it("renders an inline createSurface while it streams, with its prose as chat markdown", () => {
    const line = JSON.stringify({
      version: "v1.0",
      createSurface: {
        surfaceId: "s1",
        components: [
          { id: "root", component: "Column", children: ["intro", "buy"] },
          { id: "intro", component: "Text", text: "Pick one plan." },
          { id: "buy", component: "Button", label: "Buy" },
        ],
      },
    });
    // The line stops in the middle of its closing brackets.
    const { element } = renderMessages(
      [
        {
          id: "m1",
          role: "assistant",
          content: `Hi\n\`\`\`a2ui\n${line.slice(0, -3)}`,
        },
      ],
      { running: true },
    );

    expect(chatSurfaces(element)).toHaveLength(1);
    const surface = chatSurfaces(element)[0]!;
    expect(buttonText(surface)).toBe("Buy");
    expect(element.textContent).toContain("Pick one plan.");
    expect(surface.textContent).not.toContain("Pick one plan.");
    expect(element.querySelector("[data-testid=surface-text]")).toBeNull();
  });

  it("renders a later reply that reuses a surfaceId as its own surface, under that reply", () => {
    const { elements } = renderMessages([
      {
        id: "m1",
        role: "assistant",
        content: fence([create("s1"), buttonRoot("s1", "Buy")]),
      },
      {
        id: "m2",
        role: "assistant",
        content: `Another one.\n${fence([buttonRoot("s1", "Buy now")])}`,
      },
    ]);
    const [first, second] = elements as [HTMLElement, HTMLElement];
    expect(chatSurfaces(first)).toHaveLength(1);
    expect(chatSurfaces(second)).toHaveLength(1);
    expect(buttonText(chatSurfaces(first)[0]!)).toBe("Buy");
    expect(buttonText(chatSurfaces(second)[0]!)).toBe("Buy now");
    expect(second.textContent).toContain("Another one.");
  });

  it("renders a target=<id> fence inside <copilot-generative-ui-surface id> and not in the chat", () => {
    const content = `Look right.\n\n${fence(
      [create("recs"), buttonRoot("recs", "Try this")],
      " target=recommendations",
    )}`;
    const { element, runtime } = render(content);
    const inline = TestBed.createComponent(InlineHost);
    inline.detectChanges();
    inline.detectChanges();
    expect(
      runtime.manager.getSurfaceForTarget("recommendations")?.surfaceId,
    ).toBe("recs");
    expect(
      buttonText(inline.nativeElement.querySelector("[data-testid=inline]")),
    ).toBe("Try this");
    expect(chatSurfaces(element)).toHaveLength(0);
    expect(element.textContent).toContain("Look right.");
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

const textChunk = (messageId: string, delta: string): BaseEvent =>
  ({ type: EventType.TEXT_MESSAGE_CHUNK, messageId, delta }) as BaseEvent;

describe("markdown transport context", () => {
  function setup(config: Partial<GenerativeUIMarkdownConfig> = {}) {
    CapturingAgent.inputs = [];
    const agent = new CapturingAgent("default");
    const other = new CapturingAgent("other");
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({
          licenseKey: "ck_pub_000000000000000000000000",
          agents: { default: agent, other },
        }),
        provideGenerativeUI({ ui, transport: "markdown", ...config }),
      ],
    });
    const { core } = TestBed.inject(CopilotKit);
    // The mounted addToCart, as a component would mount it.
    const injector = createEnvironmentInjector(
      [],
      TestBed.inject(EnvironmentInjector),
    );
    registerGenerativeUIFunction(ui, "addToCart", () => undefined, {
      injector,
    });
    const fixture = TestBed.createComponent(InlineHost);
    fixture.detectChanges();
    /** Runs `agent` once, with `emit` between the run start and its end. */
    const run = async (agent: CapturingAgent, emit: () => void = () => {}) => {
      const index = CapturingAgent.inputs.length;
      const pending = core.runAgent({ agent });
      await vi.waitFor(() =>
        expect(CapturingAgent.inputs.length).toBeGreaterThan(index),
      );
      agent.start();
      emit();
      agent.finish();
      await pending;
      fixture.detectChanges();
      return CapturingAgent.inputs[index]!;
    };
    return { agent, other, core, run };
  }

  it("sends the schema and the guideline as context only to the agents in agentIds", async () => {
    const { agent, other, run } = setup({ agentIds: ["default"] });

    const listed = await run(agent);
    const unlisted = await run(other);

    expect(listed.context.map((entry) => entry.description)).toEqual([
      GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
      GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
    ]);
    // The UI has a multiple slot and the mounted addToCart, but no events.
    expect(listed.context[0]!.value).toBe(
      buildGenerativeUIMarkdownGuidelines({
        functions: true,
        events: false,
        templates: true,
        checks: false,
      }),
    );
    expect(JSON.parse(listed.context[1]!.value)).toEqual({
      catalogId: "shop",
      targets: [
        { id: "chat", kind: "chat" },
        {
          id: "recommendations",
          kind: "inline",
          description: TARGET_DESCRIPTION,
        },
      ],
      functions: expect.objectContaining({
        addToCart: { parameters: "{ sku: string }" },
        formatCurrency: expect.any(Object),
      }),
      components: {
        Button: { props: { label: "string" } },
        Column: expect.any(Object),
        Text: { props: { text: "string" } },
      },
      surfaces: {},
    });
    expect(unlisted.context).toEqual([]);
  });

  it("sends the dropped operations of a surface in the schema of the next run", async () => {
    const { agent, run } = setup();
    const missing = {
      version: "v1.0",
      updateComponents: {
        surfaceId: "s1",
        components: [{ id: "extra", component: "Missing" }],
      },
    };
    await run(agent, () => {
      agent.emit(
        textChunk(
          "m1",
          fence([create("s1"), buttonRoot("s1", "Buy"), missing]),
        ),
      );
    });

    const input = await run(agent);

    const schema = input.context.find(
      (entry) =>
        entry.description === GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
    );
    expect(JSON.parse(schema?.value ?? "{}").surfaces).toEqual({
      s1: {
        target: "chat",
        rejected: [
          'operation 2: component "extra": unknown component "Missing"',
        ],
      },
    });
  });

  it("sends no context entries when sendContext is false", async () => {
    const { agent, run } = setup({ sendContext: false });

    const input = await run(agent);

    expect(input.context).toEqual([]);
  });
});
