import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { RunAgentInput } from "@ag-ui/client";
import {
  buildGenerativeUIMarkdownGuidelines,
  GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
  GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
} from "@copilotkit/shared";
import type * as SharedModule from "@copilotkit/shared";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../providers/CopilotChatConfigurationProvider";
import { CopilotChat } from "../../components/chat/CopilotChat";
import { useCopilotKit } from "../../context";
import {
  MockStepwiseAgent,
  runFinishedEvent,
  runStartedEvent,
  textChunkEvent,
} from "../../__tests__/utils/test-helpers";
import { createGenerativeUI } from "../catalog";
import { GenerativeUISurface } from "../GenerativeUISurface";
import { useGenerativeUIFunction } from "../hooks";
import type { GenerativeUIMarkdownConfig } from "../runtime-context";

// The shared test setup gives every randomUUID call the same id. Core keeps
// context entries by id, so the two entries would replace each other.
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

function Column({ children }: { children?: React.ReactNode }) {
  return <div>{children}</div>;
}

function Text({ text }: { text: string }) {
  return <p data-testid="surface-text">{text}</p>;
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

function AddToCart() {
  useGenerativeUIFunction(ui, "addToCart", () => undefined);
  return null;
}

type CopilotKit = ReturnType<typeof useCopilotKit>["copilotkit"];

function setup(config: Partial<GenerativeUIMarkdownConfig> = {}) {
  CapturingAgent.inputs = [];
  const agent = new CapturingAgent();
  const other = new CapturingAgent();
  const captured: { copilotkit?: CopilotKit } = {};
  function Probe() {
    captured.copilotkit = useCopilotKit().copilotkit;
    return null;
  }
  render(
    <CopilotKitProvider
      agents__unsafe_dev_only={{ default: agent, other }}
      generativeUI={{ ui, transport: "markdown", ...config }}
    >
      <CopilotChatConfigurationProvider agentId="default" threadId={T}>
        <Probe />
        <AddToCart />
        <section data-testid="inline">
          <GenerativeUISurface
            id="recommendations"
            description={TARGET_DESCRIPTION}
            fallback={<span>No recommendations yet</span>}
          />
        </section>
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );
  return { agent, other, copilotkit: captured.copilotkit! };
}

async function send(text: string) {
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(screen.getByText(text)).toBeTruthy());
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

/** Runs `agent` once to the end. Returns the input of that run. */
async function runOnce(copilotkit: CopilotKit, agent: CapturingAgent) {
  const index = CapturingAgent.inputs.length;
  const pending = copilotkit.runAgent({ agent });
  await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(index + 1));
  agent.emit(runStartedEvent());
  agent.emit(runFinishedEvent());
  await pending;
  return CapturingAgent.inputs[index];
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
    // Streamdown renders after a tick.
    expect((await screen.findByText("the offer")).dataset.streamdown).toBe(
      "strong",
    );
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

  it("sends the schema and the guideline as context only to the agents in agentIds", async () => {
    const { copilotkit, agent, other } = setup({ agentIds: ["default"] });

    const listed = await runOnce(copilotkit, agent);
    const unlisted = await runOnce(copilotkit, other);

    expect(listed.context.map((entry) => entry.description)).toEqual([
      GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
      GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
    ]);
    // The UI has a multiple slot and the mounted addToCart, but no events.
    expect(listed.context[0].value).toBe(
      buildGenerativeUIMarkdownGuidelines({
        functions: true,
        events: false,
        templates: true,
        checks: false,
      }),
    );
    expect(JSON.parse(listed.context[1].value)).toEqual({
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
    const { copilotkit, agent } = setup();
    const missing = {
      version: "v1.0",
      updateComponents: {
        surfaceId: "s1",
        components: [{ id: "extra", component: "Missing" }],
      },
    };
    await reply(agent, "show", "m1", [
      fence([create("s1"), buttonRoot("s1", "Buy"), missing]),
    ]);
    await waitFor(() => expect(chatSurfaces()).toHaveLength(1));

    const input = await runOnce(copilotkit, agent);

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
    const { copilotkit, agent } = setup({ sendContext: false });

    const input = await runOnce(copilotkit, agent);

    expect(input.context).toEqual([]);
  });
});
