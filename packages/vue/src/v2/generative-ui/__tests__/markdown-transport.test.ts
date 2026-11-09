import { render, waitFor } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import { defineComponent, provide } from "vue";
import { z } from "zod";
import {
  buildGenerativeUIMarkdownGuidelines,
  GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
  GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
} from "@copilotkit/shared";
import { CopilotKitCoreVue } from "../../lib/vue-core";
import {
  runFinishedEvent,
  runStartedEvent,
  textChunkEvent,
} from "../../__tests__/utils/test-helpers";
import { createGenerativeUI } from "../catalog";
import GenerativeUISurface from "../GenerativeUISurface.vue";
import { useGenerativeUIFunction } from "../hooks";
import { GenerativeUIRuntimeKey } from "../runtime-context";
import type { GenerativeUIMarkdownConfig } from "../runtime-context";
import { useGenerativeUIRoot } from "../use-generative-ui-root";
import { CapturingAgent, runOnce } from "./helpers/capturing-agent";

// The context cases of React's markdown-transport.test.tsx. The Vue
// provider gets its `generativeUI` prop in a later change, so the root
// composable that the provider runs stands in for `<CopilotKitProvider
// :generative-ui>`, as Angular's "markdown transport context" cases do.
// The rendering cases need `CopilotChat` and move here with the provider
// wiring; `markdown-surfaces.test.ts` covers them at the component boundary.

const Noop = defineComponent({ render: () => null });

const ui = createGenerativeUI({
  id: "shop",
  functions: {
    addToCart: { parameters: z.object({ sku: z.string() }) },
  },
  components: {
    Button: { component: Noop, props: z.object({ label: z.string() }) },
    Column: { component: Noop, slots: { children: "multiple" } },
    Text: { component: Noop, props: z.object({ text: z.string() }) },
  },
});

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

function setup(config: Partial<GenerativeUIMarkdownConfig> = {}) {
  CapturingAgent.inputs = [];
  const agent = new CapturingAgent();
  const other = new CapturingAgent();
  const copilotkit = new CopilotKitCoreVue({
    agents__unsafe_dev_only: { default: agent, other },
  });
  const Root = defineComponent({
    setup() {
      provide(
        GenerativeUIRuntimeKey,
        useGenerativeUIRoot(copilotkit, () => ({
          ...config,
          ui,
          transport: "markdown",
        })),
      );
      return {};
    },
    template: "<slot />",
  });
  const Host = defineComponent({
    components: { Root, AddToCart, GenerativeUISurface },
    setup: () => ({ TARGET_DESCRIPTION }),
    template: `
      <Root>
        <AddToCart />
        <section data-testid="inline">
          <GenerativeUISurface id="recommendations" :description="TARGET_DESCRIPTION">
            <span>No recommendations yet</span>
          </GenerativeUISurface>
        </section>
      </Root>
    `,
  });
  render(Host);
  return { agent, other, copilotkit };
}

/**
 * Runs `agent` once to the end, with `chunks` as one assistant message.
 * Returns the input of that run.
 */
async function reply(
  copilotkit: CopilotKitCoreVue,
  agent: CapturingAgent,
  messageId: string,
  chunks: string[],
) {
  const index = CapturingAgent.inputs.length;
  const pending = copilotkit.runAgent({ agent });
  await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(index + 1));
  agent.emit(runStartedEvent());
  for (const chunk of chunks) agent.emit(textChunkEvent(messageId, chunk));
  agent.emit(runFinishedEvent());
  await pending;
  return CapturingAgent.inputs[index];
}

describe("markdown transport", () => {
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
        components: ["Button", "Column", "Text"],
        functions: true,
        events: false,
        templates: true,
        checks: false,
      }),
    );
    // The schema in the lines notation that ships: one line per component
    // and prop.
    const schema = listed.context[1].value;
    expect(schema).toContain("Catalog shop.");
    expect(schema).toContain(`recommendations (inline): ${TARGET_DESCRIPTION}`);
    expect(schema).toContain("addToCart{ sku: string }");
    expect(schema).toContain("\nButton\n label*: string");
    expect(schema).toContain("\nText\n text*: string");
    expect(schema).toMatch(/\nColumn/);
    expect(schema).toContain("Surfaces: none");
    expect(unlisted.context).toEqual([]);
  });

  it("sends the dropped operations of a surface in the schema of the next run", async () => {
    const { copilotkit, agent } = setup();
    const missing = {
      version: "1.0",
      updateComponents: {
        surfaceId: "s1",
        components: [{ id: "extra", component: "Missing" }],
      },
    };
    await reply(copilotkit, agent, "m1", [
      fence([create("s1"), buttonRoot("s1", "Buy"), missing]),
    ]);

    const input = await runOnce(copilotkit, agent);

    const schema = input.context.find(
      (entry) =>
        entry.description === GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
    );
    const value = schema?.value ?? "";
    // The surfaces are the last line of the schema, as JSON.
    const surfaces = value.slice(
      value.indexOf("Surfaces: ") + "Surfaces: ".length,
    );
    expect(JSON.parse(surfaces)).toEqual({
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
