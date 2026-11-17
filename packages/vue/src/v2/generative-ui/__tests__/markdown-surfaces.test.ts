import { render, screen, waitFor, within } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import { defineComponent, nextTick, shallowRef } from "vue";
import { z } from "zod";
import type { Message } from "@ag-ui/client";
import { getMarkdownSurfaceSource } from "@copilotkit/core/generative-ui";
import type { AnyGenerativeUI } from "@copilotkit/shared/generative-ui";
import { createGenerativeUI } from "../catalog";
import GenerativeUISurface from "../GenerativeUISurface.vue";
import MarkdownSurfaces from "../markdown/MarkdownSurfaces.vue";
import {
  createRuntimeProvider,
  createTestRuntime,
} from "./helpers/render-surface";

// The rendering cases go through `MarkdownSurfaces` with a stub runtime,
// as Angular's markdown-surfaces.spec.ts does. React runs the same cases
// through `CopilotChat` in markdown-transport.test.tsx.

const Button = defineComponent({
  props: { label: { type: String, required: true } },
  template: `<button>{{ label }}</button>`,
});
const Column = defineComponent({
  template: `<div><slot name="children" /></div>`,
});
const Text = defineComponent({
  props: { text: { type: String, required: true } },
  template: `<p data-testid="surface-text">{{ text }}</p>`,
});

const ui = createGenerativeUI({
  id: "shop",
  components: {
    Button: { component: Button, props: z.object({ label: z.string() }) },
    Column: { component: Column, slots: { children: "multiple" } },
    Text: { component: Text, props: z.object({ text: z.string() }) },
  },
});

const T = "thread-1";

const create = (surfaceId: string) => ({
  version: "1.0",
  createSurface: { surfaceId, catalogId: "shop" },
});
const buttonRoot = (surfaceId: string, label: string) => ({
  version: "1.0",
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

const assistant = (id: string, content: string): Message => ({
  id,
  role: "assistant",
  content,
});

const chatSurfaces = (root: ParentNode = document) =>
  root.querySelectorAll<HTMLElement>("[data-generative-ui-chat-surface]");
const buttonText = (surface: Element) =>
  surface.querySelector("button")?.textContent?.trim();

/**
 * Renders the assistant messages of one thread with a stub runtime, each
 * with `MarkdownSurfaces` in a `[data-message-id]` element. The messages are
 * synced the way the root syncs them. A `<GenerativeUISurface
 * id="recommendations">` with a fallback is mounted next to them.
 */
function renderMessages(messages: Message[], { running = false } = {}) {
  const { runtime } = createTestRuntime(ui);
  runtime.transport = "markdown";
  runtime.manager.setActiveThread(T);
  // The engine's `ui` type takes function and class components only.
  const engineUI: AnyGenerativeUI = ui;
  const source = getMarkdownSurfaceSource({
    manager: runtime.manager,
    ui: engineUI,
  });
  source.sync(T, "default", messages, { running });
  const current = shallowRef(messages);
  const Provider = createRuntimeProvider(runtime);
  const Host = defineComponent({
    components: { Provider, MarkdownSurfaces, GenerativeUISurface },
    setup: () => ({ current }),
    template: `
      <Provider>
        <section data-testid="inline">
          <GenerativeUISurface id="recommendations">
            <span>No recommendations yet</span>
          </GenerativeUISurface>
        </section>
        <div v-for="message in current" :key="message.id" :data-message-id="message.id">
          <MarkdownSurfaces :content="message.content ?? ''" :message-id="message.id" />
        </div>
      </Provider>
    `,
  });
  render(Host);
  const messageElement = (id: string) =>
    document.querySelector<HTMLElement>(`[data-message-id="${id}"]`)!;
  /** More of the same messages arrived: syncs and renders them again. */
  const stream = (next: Message[], options = { running: false }) => {
    source.sync(T, "default", next, options);
    current.value = next;
    return nextTick();
  };
  return { runtime, messageElement, stream };
}

describe("MarkdownSurfaces", () => {
  it("renders a fence as a surface in the message and the prose around it as markdown", async () => {
    const { messageElement } = renderMessages([
      assistant(
        "m1",
        `Here is **the offer**:\n\n${fence([create("s1"), buttonRoot("s1", "Buy")])}\nOutro paragraph.`,
      ),
    ]);
    const element = messageElement("m1");

    expect(chatSurfaces(element)).toHaveLength(1);
    expect(chatSurfaces(element)[0].dataset.generativeUiChatSurface).toBe("s1");
    expect(buttonText(chatSurfaces(element)[0])).toBe("Buy");
    await waitFor(() =>
      expect(element.querySelector("strong")?.textContent).toBe("the offer"),
    );
    expect(element.textContent).toContain("Outro paragraph.");
    expect(element.textContent).not.toContain("createSurface");
  });

  it("shows nothing for a half-streamed fence until its root operation is complete", async () => {
    const createLine = JSON.stringify(create("s1"));
    const rootLine = JSON.stringify(buttonRoot("s1", "Buy"));
    const half = `Hi\n\`\`\`a2ui\n${createLine}\n${rootLine.slice(0, 60)}`;
    const { messageElement, stream } = renderMessages([assistant("m1", half)], {
      running: true,
    });
    expect(chatSurfaces(messageElement("m1"))).toHaveLength(0);
    await waitFor(() =>
      expect(messageElement("m1").textContent).toContain("Hi"),
    );

    await stream([assistant("m1", `${half}${rootLine.slice(60)}\n\`\`\`\n`)]);

    expect(chatSurfaces(messageElement("m1"))).toHaveLength(1);
    expect(buttonText(chatSurfaces(messageElement("m1"))[0])).toBe("Buy");
  });

  it("renders an inline createSurface while it streams, with its prose as chat markdown", async () => {
    const line = JSON.stringify({
      version: "1.0",
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
    const { messageElement } = renderMessages(
      [assistant("m1", `Hi\n\`\`\`a2ui\n${line.slice(0, -3)}`)],
      { running: true },
    );
    const element = messageElement("m1");

    expect(chatSurfaces(element)).toHaveLength(1);
    const surface = chatSurfaces(element)[0];
    expect(buttonText(surface)).toBe("Buy");
    await waitFor(() =>
      expect(element.textContent).toContain("Pick one plan."),
    );
    expect(surface.textContent).not.toContain("Pick one plan.");
    expect(screen.queryByTestId("surface-text")).toBeNull();
  });

  it("renders a later reply that reuses a surfaceId as its own surface, under that reply", async () => {
    const { messageElement } = renderMessages([
      assistant("m1", fence([create("s1"), buttonRoot("s1", "Buy")])),
      assistant("m2", `Another one.\n${fence([buttonRoot("s1", "Buy now")])}`),
    ]);
    const first = messageElement("m1");
    const second = messageElement("m2");

    expect(chatSurfaces(first)).toHaveLength(1);
    expect(chatSurfaces(second)).toHaveLength(1);
    expect(buttonText(chatSurfaces(first)[0])).toBe("Buy");
    expect(buttonText(chatSurfaces(second)[0])).toBe("Buy now");
    await waitFor(() => expect(second.textContent).toContain("Another one."));
  });

  it("renders a target=<id> fence inside <GenerativeUISurface id> and not in the chat", async () => {
    const { messageElement } = renderMessages([
      assistant(
        "m1",
        `Look right.\n\n${fence(
          [create("recs"), buttonRoot("recs", "Try this")],
          " target=recommendations",
        )}`,
      ),
    ]);

    const inline = screen.getByTestId("inline");
    expect(within(inline).getByRole("button").textContent).toBe("Try this");
    expect(within(inline).queryByText("No recommendations yet")).toBeNull();
    expect(chatSurfaces()).toHaveLength(0);
    await waitFor(() =>
      expect(messageElement("m1").textContent).toContain("Look right."),
    );
  });
});

describe("MarkdownSurfaces (Vue-specific semantics)", () => {
  it("draws the markdown surface without the box of the tool card, with the fade marker", () => {
    const { messageElement } = renderMessages([
      assistant("m1", fence([create("s1"), buttonRoot("s1", "Buy")])),
    ]);

    const surface = chatSurfaces(messageElement("m1"))[0];
    expect(surface.dataset.a2uiMarkdownSurface).toBe("s1");
    expect(surface.classList.contains("cpk:border")).toBe(false);
    expect(document.getElementById("a2ui-markdown-fade")).not.toBeNull();
  });
});
