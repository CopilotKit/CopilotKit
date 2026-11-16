import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/vue";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, onMounted, shallowRef } from "vue";
import type { PropType } from "vue";
import { z } from "zod";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import {
  envelopeToManifest,
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_FUNCTION_CALL_ACTIVITY_TYPE,
  GENERATIVE_UI_RENDER_TOOL,
  isA2UIBasicFunction,
  readCopilotKitUIEnvelope,
} from "@copilotkit/shared";
import CopilotKitProvider from "../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../providers/CopilotChatConfigurationProvider.vue";
import { useCopilotKit } from "../../providers/useCopilotKit";
import CopilotChat from "../../components/chat/CopilotChat.vue";
import CopilotPopup from "../../components/chat/CopilotPopup.vue";
import CopilotSidebar from "../../components/chat/CopilotSidebar.vue";
import type { CopilotKitCoreVue } from "../../lib/vue-core";
import { MCPAppsActivityType } from "../../components/MCPAppsActivityRenderer";
import {
  runFinishedEvent,
  runStartedEvent,
} from "../../__tests__/utils/test-helpers";
import { createGenerativeUI } from "../catalog";
import type { GenerativeUIChatSurfaceSlotProps } from "../chat";
import GenerativeUISurface from "../GenerativeUISurface.vue";
import { useGenerativeUIFunction } from "../hooks";
import { useGenerativeUIRuntime } from "../runtime-context";
import type {
  GenerativeUIRuntime,
  GenerativeUITheme,
} from "../runtime-context";
import { CapturingAgent } from "./helpers/capturing-agent";

// The Vue port of React's generative-ui.integration.test.tsx: the real
// `CopilotKitProvider` with `:generativeUI`, and `CopilotChat`. React's
// `generativeUISurface` prop is the `#generative-ui-surface` slot here.

const mounts = new Map<string, number>();
const Card = defineComponent({
  props: {
    productId: { type: String, required: true },
    name: { type: String, required: true },
    onAddToCart: {
      type: Function as PropType<(args: { productId: string }) => void>,
      default: undefined,
    },
  },
  setup(props) {
    onMounted(() => {
      mounts.set(props.productId, (mounts.get(props.productId) ?? 0) + 1);
    });
    return {};
  },
  template: `
    <div :data-testid="'card-' + productId">
      {{ name }}
      <button @click="onAddToCart?.({ productId })">Add {{ productId }}</button>
    </div>
  `,
});
const Grid = defineComponent({
  template: `<div><slot name="children" /></div>`,
});
const ui = createGenerativeUI({
  id: "shop",
  functions: {
    addToCart: { parameters: z.object({ productId: z.string() }) },
    applyCoupon: { parameters: z.object({}) },
  },
  components: {
    Grid: { component: Grid, slots: { children: "multiple" } },
    // `onAddToCart` calls the `addToCart` function.
    Card: {
      component: Card,
      props: z.object({ productId: z.string(), name: z.string() }),
      events: { onAddToCart: {} },
    },
  },
});

const T = "thread-1";
const create = (surfaceId: string) => ({
  version: "1.0",
  createSurface: { surfaceId, catalogId: "shop" },
});
const nodes = (surfaceId: string, ...components: unknown[]) => ({
  version: "1.0",
  updateComponents: { surfaceId, components },
});
const snapshot = (
  surfaceId: string,
  target: string,
  operations: unknown[],
): BaseEvent => ({
  type: EventType.ACTIVITY_SNAPSHOT,
  messageId: `genui:${surfaceId}`,
  activityType: GENERATIVE_UI_ACTIVITY_TYPE,
  content: {
    surfaceId,
    target,
    catalogId: "shop",
    operations,
    status: "streaming",
    rejected: [],
  },
  replace: true,
});
const append = (surfaceId: string, op: unknown): BaseEvent => ({
  type: EventType.ACTIVITY_DELTA,
  messageId: `genui:${surfaceId}`,
  activityType: GENERATIVE_UI_ACTIVITY_TYPE,
  patch: [{ op: "add", path: "/operations/-", value: op }],
});
const patch = (surfaceId: string, ...ops: unknown[]): BaseEvent => ({
  type: EventType.ACTIVITY_DELTA,
  messageId: `genui:${surfaceId}`,
  activityType: GENERATIVE_UI_ACTIVITY_TYPE,
  patch: ops,
});
const card = (id: string) => ({
  id,
  component: "Card",
  productId: id,
  name: `Product ${id}`,
});

const cardEl = () =>
  document.querySelector<HTMLElement>(
    '[data-generative-ui-chat-surface="cmp"]',
  );

const surfaceRoot = (surfaceId: string) =>
  document.querySelector<HTMLElement>(
    `[data-generative-ui-root="${surfaceId}"]`,
  )!;

const Handlers = defineComponent({
  props: {
    addToCart: {
      type: Function as PropType<(args: { productId: string }) => void>,
      required: true,
    },
  },
  setup(props) {
    useGenerativeUIFunction(ui, "addToCart", (args) => props.addToCart(args));
    useGenerativeUIFunction(ui, "applyCoupon", async () => "ok");
    return () => null;
  },
});

function setup(theme?: GenerativeUITheme) {
  CapturingAgent.inputs = [];
  mounts.clear();
  const agent = new CapturingAgent();
  const addToCart = vi.fn();
  const currentTheme = shallowRef(theme);
  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChat,
      GenerativeUISurface,
      Handlers,
    },
    setup: () => ({ agent, addToCart, ui, currentTheme, T }),
    template: `
      <CopilotKitProvider
        :agents__unsafe_dev_only="{ default: agent }"
        :generativeUI="{ ui, theme: currentTheme }"
      >
        <CopilotChatConfigurationProvider agent-id="default" :thread-id="T">
          <Handlers :add-to-cart="addToCart" />
          <section data-testid="inline">
            <GenerativeUISurface
              id="recommendations"
              :ui="ui"
              description="Next to the product list. Use it for recommendations."
              :components="['Grid', 'Card']"
            >
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
  return {
    agent,
    addToCart,
    setTheme: (next: GenerativeUITheme) => {
      currentTheme.value = next;
      return nextTick();
    },
  };
}

/** The manifest that a run sent, read the way the runtime reads it. */
function manifestOf(input: RunAgentInput | undefined) {
  const envelope = readCopilotKitUIEnvelope(input?.forwardedProps);
  return envelope && envelopeToManifest(envelope);
}

/**
 * Sends `text` from the chat input, and waits until the run has started.
 * The capturing agent does not buffer events, so the test emits after this.
 */
async function send(text: string) {
  // One macrotask lets core end the previous run first. Core sets the
  // envelope of a run only when no other run of the agent is in flight.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const runs = CapturingAgent.inputs.length;
  const input = await screen.findByRole("textbox");
  await fireEvent.update(input, text);
  await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(screen.getByText(text)).toBeTruthy());
  await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(runs + 1));
}

describe("generative UI integration", () => {
  it("sends an envelope with mounted targets, their descriptions and components, and the functions with a handler", async () => {
    const { agent } = setup();
    await send("hi");
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));
    const manifest = manifestOf(CapturingAgent.inputs[0]);
    expect(manifest?.catalogId).toBe("shop");
    expect(manifest?.targets).toEqual([
      { id: "chat", kind: "chat" },
      {
        id: "recommendations",
        kind: "inline",
        description: "Next to the product list. Use it for recommendations.",
        components: ["Grid", "Card"],
      },
    ]);
    // The app functions, next to the built-in ones of the catalog.
    const appFunctions = Object.keys(manifest?.functions ?? {}).filter(
      (name) => !isA2UIBasicFunction(name),
    );
    expect(appFunctions.sort()).toEqual(["addToCart", "applyCoupon"]);
    expect(manifest?.functions).toHaveProperty("formatCurrency");
    expect(Object.keys(manifest?.components ?? {})).toEqual(["Grid", "Card"]);
  });

  it("renders inline-targeted surfaces only in their mount and binds clicks to host functions", async () => {
    const { agent, addToCart } = setup();
    expect(screen.getByText("No recommendations yet")).toBeTruthy();
    await send("recommend");
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    agent.emit(snapshot("recs", "recommendations", [create("recs")]));
    agent.emit(
      append(
        "recs",
        nodes("recs", { id: "root", component: "Grid", children: ["p1"] }),
      ),
    );
    agent.emit(append("recs", nodes("recs", card("p1"))));
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));

    const inline = screen.getByTestId("inline");
    await waitFor(() =>
      expect(within(inline).getByText("Product p1")).toBeTruthy(),
    );
    expect(screen.getAllByText("Product p1")).toHaveLength(1);

    const runsBefore = CapturingAgent.inputs.length;
    await fireEvent.click(within(inline).getByText("Add p1"));
    await waitFor(() =>
      expect(addToCart).toHaveBeenCalledExactlyOnceWith({ productId: "p1" }),
    );
    expect(CapturingAgent.inputs.length).toBe(runsBefore);
  });

  it("renders chat-targeted surfaces in the transcript with the default card", async () => {
    const { agent } = setup();
    await send("compare");
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    agent.emit(
      snapshot("cmp", "chat", [create("cmp"), nodes("cmp", card("root"))]),
    );
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));
    await waitFor(() => {
      const chatCard = document.querySelector(
        '[data-generative-ui-chat-surface="cmp"]',
      );
      expect(chatCard?.textContent).toContain("Product root");
    });
    expect(
      within(screen.getByTestId("inline")).queryByText("Product root"),
    ).toBeNull();
  });

  it("shows a friendly chat-card error only while the latest call has rejections", async () => {
    const { agent } = setup();
    await send("compare");
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    // Turn 1: the server rejected op 2, and op 1 fails client-side (unknown component).
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
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));
    await waitFor(() =>
      expect(within(cardEl()!).getByRole("alert").textContent?.trim()).toBe(
        "Part of this UI couldn't be shown.",
      ),
    );
    expect(cardEl()!.textContent).not.toContain("category");

    // Turn 2: the model repairs the card; the runtime resets status and rejected.
    await send("fix it");
    agent.emit(runStartedEvent({ threadId: T, runId: "r2" }));
    agent.emit(
      patch(
        "cmp",
        { op: "replace", path: "/status", value: "streaming" },
        { op: "replace", path: "/rejected", value: [] },
        { op: "add", path: "/operations/-", value: nodes("cmp", card("root")) },
      ),
    );
    agent.emit(
      patch("cmp", { op: "replace", path: "/status", value: "ready" }),
    );
    agent.emit(runFinishedEvent({ threadId: T, runId: "r2" }));
    await waitFor(() =>
      expect(cardEl()!.textContent).toContain("Product root"),
    );
    expect(within(cardEl()!).queryByRole("alert")).toBeNull();
  });

  it("shows the chat-card error when the createSurface itself is rejected", async () => {
    const { agent } = setup();
    await send("compare");
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    agent.emit(
      snapshot("cmp", "chat", [
        {
          version: "1.0",
          createSurface: {
            surfaceId: "cmp",
            catalogId: "shop",
            components: [{ id: "root", component: "Nope" }],
          },
        },
      ]),
    );
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));
    await waitFor(() =>
      expect(within(cardEl()!).getByRole("alert").textContent?.trim()).toBe(
        "Part of this UI couldn't be shown.",
      ),
    );
  });

  it("passes the raw rejection list to a custom chat wrapper", async () => {
    const agent = renderWithSurfaceSlot("CopilotChat");
    await send("compare");
    const reason = 'component "p3": unknown prop "category"';
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    agent.emit(snapshot("cmp", "chat", [create("cmp")]));
    agent.emit(
      patch("cmp", {
        op: "add",
        path: "/rejected/-",
        value: { index: 1, reason },
      }),
    );
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));
    const expected = [{ index: 1, reason }];
    await waitFor(() =>
      expect(seen.at(-1)).toEqual({ cause: expected, rejected: expected }),
    );
  });

  it("second run updates the inline surface in place", async () => {
    const { agent } = setup();
    await send("recommend");
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    agent.emit(
      snapshot("recs", "recommendations", [
        create("recs"),
        nodes("recs", {
          id: "root",
          component: "Grid",
          children: ["p1", "p2"],
        }),
        nodes("recs", card("p1")),
      ]),
    );
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));
    await waitFor(() => expect(screen.getByText("Product p1")).toBeTruthy());

    await send("one more");
    expect(manifestOf(CapturingAgent.inputs.at(-1))?.surfaces).toEqual({
      recs: { target: "recommendations" },
    });
    agent.emit(runStartedEvent({ threadId: T, runId: "r2" }));
    agent.emit(append("recs", nodes("recs", card("p2"))));
    agent.emit(runFinishedEvent({ threadId: T, runId: "r2" }));
    await waitFor(() => expect(screen.getByText("Product p2")).toBeTruthy());
    expect(mounts.get("p1")).toBe(1);
  });

  it("sets the theme variables in a stylesheet of the surface root and updates them without a remount", async () => {
    const { agent, setTheme } = setup({
      "--a2ui-color-accent": "#111111",
      mapStyle: "https://tiles.example/style.json",
    });
    await send("recommend");
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    agent.emit(
      snapshot("recs", "recommendations", [
        create("recs"),
        nodes("recs", card("root")),
      ]),
    );
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));
    await waitFor(() => expect(screen.getByText("Product root")).toBeTruthy());
    const css = () =>
      surfaceRoot("recs").querySelector("style")?.textContent ?? "";
    const id = () => surfaceRoot("recs").getAttribute("data-a2ui-theme");
    expect(css()).toBe(
      `.a2ui-surface[data-a2ui-theme="${id()}"]{--a2ui-color-accent:#111111}`,
    );
    expect(css()).not.toContain("tiles.example");

    await setTheme({
      "--a2ui-color-accent": "#222222",
      dark: { "--a2ui-color-accent": "#eeeeee" },
    });

    const self = `.a2ui-surface[data-a2ui-theme="${id()}"]`;
    expect(css()).toBe(
      `${self}{--a2ui-color-accent:#222222}:where(.dark) ${self},${self}:where(.dark){--a2ui-color-accent:#eeeeee}`,
    );
    expect(mounts.get("root")).toBe(1);
  });
});

/** What the custom `#generative-ui-surface` slot got, one entry per render. */
const seen: unknown[] = [];

/**
 * Renders `chat` (CopilotChat, CopilotPopup, or CopilotSidebar) with a
 * `#generative-ui-surface` slot. The slot records `error.cause` and
 * `rejected` in `seen`, and renders `children` in a custom wrapper.
 */
function renderWithSurfaceSlot(
  chat: "CopilotChat" | "CopilotPopup" | "CopilotSidebar",
) {
  CapturingAgent.inputs = [];
  seen.length = 0;
  const agent = new CapturingAgent();
  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChat,
      CopilotPopup,
      CopilotSidebar,
    },
    setup: () => ({
      agent,
      ui,
      chat,
      T,
      record: ({ error, rejected }: GenerativeUIChatSurfaceSlotProps) => {
        seen.push({ cause: error?.cause, rejected });
      },
    }),
    template: `
      <CopilotKitProvider
        :agents__unsafe_dev_only="{ default: agent }"
        :generativeUI="{ ui }"
      >
        <CopilotChatConfigurationProvider agent-id="default" :thread-id="T">
          <div style="height: 400px">
            <component :is="chat" :welcome-screen="false">
              <template #generative-ui-surface="surface">
                {{ record(surface) }}
                <div data-testid="custom-wrapper" :data-surface-id="surface.surfaceId">
                  <component :is="surface.children" />
                </div>
              </template>
            </component>
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });
  render(Host);
  return agent;
}

describe("generative UI integration (Vue-specific semantics)", () => {
  it.each(["CopilotChat", "CopilotPopup", "CopilotSidebar"] as const)(
    "renders the surface as `children` of a custom #generative-ui-surface slot on %s",
    async (chat) => {
      const agent = renderWithSurfaceSlot(chat);
      await send("compare");
      agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
      agent.emit(
        snapshot("cmp", "chat", [create("cmp"), nodes("cmp", card("root"))]),
      );
      agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));

      const wrapper = await screen.findByTestId("custom-wrapper");
      expect(wrapper.dataset.surfaceId).toBe("cmp");
      await waitFor(() =>
        expect(within(wrapper).getByText("Product root")).toBeTruthy(),
      );
      // The slot replaces the default card.
      expect(cardEl()).toBeNull();
    },
  );

  /**
   * Renders a bare provider, with `:generativeUI="{ ui }"` when
   * `withConfig`. Returns what the children see: the runtime, the activity
   * types and the tool names that the provider registered on core.
   */
  function renderProvider(withConfig: boolean) {
    const agent = new CapturingAgent();
    let copilotkit: CopilotKitCoreVue | undefined;
    let runtime: GenerativeUIRuntime | null = null;
    const Probe = defineComponent({
      setup() {
        copilotkit = useCopilotKit().copilotkit.value;
        runtime = useGenerativeUIRuntime().value;
        return () => null;
      },
    });
    const Host = defineComponent({
      components: { CopilotKitProvider, Probe },
      setup: () => ({
        agent,
        generativeUI: withConfig ? { ui } : undefined,
      }),
      template: `
        <CopilotKitProvider
          :agents__unsafe_dev_only="{ default: agent }"
          :generativeUI="generativeUI"
        >
          <Probe />
        </CopilotKitProvider>
      `,
    });
    render(Host);
    if (!copilotkit) throw new Error("The probe did not render.");
    return {
      runtime,
      activityTypes: copilotkit.renderActivityMessages.map(
        (renderer) => renderer.activityType,
      ),
      toolNames: copilotkit.renderToolCalls.map((renderer) => renderer.name),
    };
  }

  it("registers the generative UI renderers after the built-ins and provides the runtime with a generativeUI config", () => {
    const { runtime, activityTypes, toolNames } = renderProvider(true);

    expect(runtime?.ui).toBe(ui);
    expect(runtime?.transport).toBe("tool");
    expect(activityTypes).toEqual([
      MCPAppsActivityType,
      GENERATIVE_UI_ACTIVITY_TYPE,
      GENERATIVE_UI_FUNCTION_CALL_ACTIVITY_TYPE,
    ]);
    expect(toolNames).toEqual([GENERATIVE_UI_RENDER_TOOL]);
  });

  it("registers no generative UI renderers and provides a null runtime without a generativeUI config", () => {
    const { runtime, activityTypes, toolNames } = renderProvider(false);

    expect(runtime).toBeNull();
    expect(activityTypes).toEqual([MCPAppsActivityType]);
    expect(toolNames).toEqual([]);
  });
});
