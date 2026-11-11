import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import { z } from "zod";
import CopilotKitProvider from "../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChat from "../../components/chat/CopilotChat.vue";
import {
  runFinishedEvent,
  runStartedEvent,
  textChunkEvent,
} from "../../__tests__/utils/test-helpers";
import { createGenerativeUI } from "../catalog";
import GenerativeUISurface from "../GenerativeUISurface.vue";
import { useGenerativeUIFunction } from "../hooks";
import { CapturingAgent } from "./helpers/capturing-agent";

// The rendering cases of React's markdown-transport.test.tsx, at the same
// boundary: the real `CopilotKitProvider` with the markdown transport, and
// `CopilotChat`. The context cases are in markdown-transport.test.ts.
//
// React's "renders the fence as code when MarkdownRenderer gets no message
// id" has no Vue counterpart: Vue has no standalone `MarkdownRenderer`, and
// the assistant message always has an id (`AssistantMessage.id` is
// required), so it always gives one to `MarkdownSurfaces`.

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

const AddToCart = defineComponent({
  setup() {
    useGenerativeUIFunction(ui, "addToCart", () => undefined);
    return () => null;
  },
});

function setup() {
  CapturingAgent.inputs = [];
  const agent = new CapturingAgent();
  const other = new CapturingAgent();
  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChat,
      GenerativeUISurface,
      AddToCart,
    },
    setup: () => ({ agent, other, ui, T, TARGET_DESCRIPTION }),
    template: `
      <CopilotKitProvider
        :agents__unsafe_dev_only="{ default: agent, other }"
        :generativeUI="{ ui, transport: 'markdown' }"
      >
        <CopilotChatConfigurationProvider agent-id="default" :thread-id="T">
          <AddToCart />
          <section data-testid="inline">
            <GenerativeUISurface id="recommendations" :description="TARGET_DESCRIPTION">
              <span>No recommendations yet</span>
            </GenerativeUISurface>
          </section>
          <div style="height: 400px">
            <CopilotChat :welcome-screen="false" />
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });
  render(Host);
  return { agent, other };
}

/**
 * Sends `text` from the chat input, and waits until the run has started.
 * The capturing agent does not buffer events, so the test emits after this.
 */
async function send(text: string) {
  // One macrotask lets core end the previous run first.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const runs = CapturingAgent.inputs.length;
  const input = await screen.findByRole("textbox");
  await fireEvent.update(input, text);
  await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(screen.getByText(text)).toBeTruthy());
  await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(runs + 1));
}

/** Sends `prompt`, then streams `chunks` as one assistant message. */
async function reply(
  agent: CapturingAgent,
  prompt: string,
  messageId: string,
  chunks: string[],
) {
  await send(prompt);
  agent.emit(runStartedEvent({ threadId: T, runId: messageId }));
  for (const chunk of chunks) agent.emit(textChunkEvent(messageId, chunk));
  agent.emit(runFinishedEvent({ threadId: T, runId: messageId }));
}

const chatSurfaces = () =>
  document.querySelectorAll<HTMLElement>("[data-generative-ui-chat-surface]");

describe("markdown transport", () => {
  it("renders a fence as a surface in the message and the prose around it as markdown", async () => {
    const { agent } = setup();

    await reply(agent, "show", "m1", [
      `Here is **the offer**:\n${fence([create("s1"), buttonRoot("s1", "Buy")])}`,
    ]);

    await waitFor(() => expect(chatSurfaces()).toHaveLength(1));
    expect(chatSurfaces()[0].dataset.generativeUiChatSurface).toBe("s1");
    expect(within(chatSurfaces()[0]).getByRole("button").textContent).toBe(
      "Buy",
    );
    // StreamMarkdown renders after a tick.
    expect((await screen.findByText("the offer")).tagName).toBe("STRONG");
    expect(screen.queryByText(/createSurface/)).toBeNull();
  });

  it("shows nothing for a half-streamed fence until its root operation is complete", async () => {
    const { agent } = setup();
    const createLine = JSON.stringify(create("s1"));
    const rootLine = JSON.stringify(buttonRoot("s1", "Buy"));
    await send("show");
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));

    agent.emit(
      textChunkEvent(
        "m1",
        `Hi\n\`\`\`a2ui\n${createLine}\n${rootLine.slice(0, 60)}`,
      ),
    );
    // The prose of the message is on screen, and the fence shows nothing.
    await screen.findByText("Hi");
    expect(chatSurfaces()).toHaveLength(0);

    agent.emit(textChunkEvent("m1", `${rootLine.slice(60)}\n\`\`\`\n`));
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));
    await waitFor(() => expect(chatSurfaces()).toHaveLength(1));
    expect(within(chatSurfaces()[0]).getByRole("button").textContent).toBe(
      "Buy",
    );
  });

  it("renders an inline createSurface while it streams, with its prose as chat markdown", async () => {
    const { agent } = setup();
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
    await send("show");
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));

    // The line stops in the middle of its closing brackets.
    agent.emit(textChunkEvent("m1", `Hi\n\`\`\`a2ui\n${line.slice(0, -3)}`));

    await waitFor(() => expect(chatSurfaces()).toHaveLength(1));
    expect(within(chatSurfaces()[0]).getByRole("button").textContent).toBe(
      "Buy",
    );
    const prose = await screen.findByText("Pick one plan.");
    expect(chatSurfaces()[0].contains(prose)).toBe(false);
    expect(screen.queryByTestId("surface-text")).toBeNull();
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));
  });

  it("renders a later reply that reuses a surfaceId as its own surface, under that reply", async () => {
    const { agent } = setup();
    await reply(agent, "show", "m1", [
      fence([create("s1"), buttonRoot("s1", "Buy")]),
    ]);
    await waitFor(() => expect(chatSurfaces()).toHaveLength(1));

    await reply(agent, "another", "m2", [
      `Another one.\n${fence([buttonRoot("s1", "Buy now")])}`,
    ]);

    await waitFor(() => expect(chatSurfaces()).toHaveLength(2));
    expect(within(chatSurfaces()[0]).getByRole("button").textContent).toBe(
      "Buy",
    );
    expect(within(chatSurfaces()[1]).getByRole("button").textContent).toBe(
      "Buy now",
    );
    const secondMessage = document.querySelector('[data-message-id="m2"]');
    expect(secondMessage?.contains(chatSurfaces()[1])).toBe(true);
    expect(await screen.findByText("Another one.")).toBeTruthy();
  });

  it("renders a target=<id> fence inside <GenerativeUISurface id> and not in the chat", async () => {
    const { agent } = setup();

    await reply(agent, "recommend", "m1", [
      fence(
        [create("recs"), buttonRoot("recs", "Try this")],
        " target=recommendations",
      ),
    ]);

    const inline = screen.getByTestId("inline");
    await waitFor(() =>
      expect(within(inline).getByRole("button").textContent).toBe("Try this"),
    );
    expect(chatSurfaces()).toHaveLength(0);
  });
});
