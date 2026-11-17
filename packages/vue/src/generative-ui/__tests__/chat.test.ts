import { render, screen, within } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import {
  computed,
  defineComponent,
  effectScope,
  nextTick,
  provide,
  ref,
  shallowRef,
  watchEffect,
} from "vue";
import type { PropType, VNode } from "vue";
import { z } from "zod";
import type { ActivityMessage } from "@ag-ui/core";
import type {
  A2UIOperation,
  GenerativeUIRejectedOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { CopilotKitCoreVue } from "../../lib/vue-core";
import CopilotChatConfigurationProvider from "../../providers/CopilotChatConfigurationProvider.vue";
import { defineToolCallRenderer } from "../../types/defineToolCallRenderer";
import { createGenerativeUI } from "../catalog";
import {
  createGenerativeUIActivityRenderer,
  createGenerativeUIFunctionCallActivityRenderer,
  GenerativeUIChatSlotKey,
  registerGenerativeUIToolCallRenderer,
} from "../chat";
import { CapturingAgent } from "./helpers/capturing-agent";
import {
  createRuntimeProvider,
  createTestRuntime,
} from "./helpers/render-surface";

const Row = defineComponent({
  props: { text: { type: String, required: true } },
  template: `<p data-row>{{ text }}</p>`,
});

const ui = createGenerativeUI({
  id: "chat/ui@1",
  components: {
    Row: { component: Row, props: z.object({ text: z.string() }) },
  },
});

const create = (surfaceId: string): A2UIOperation => ({
  version: "1.0",
  createSurface: { surfaceId, catalogId: ui.id },
});
const rowRoot = (surfaceId: string): A2UIOperation => ({
  version: "1.0",
  updateComponents: {
    surfaceId,
    components: [{ id: "root", component: "Row", text: "Hi" }],
  },
});

function content(
  surfaceId: string,
  target: string,
  overrides: Partial<GenerativeUISurfaceContent> = {},
): GenerativeUISurfaceContent {
  return {
    surfaceId,
    target,
    catalogId: ui.id,
    operations: [create(surfaceId), rowRoot(surfaceId)],
    status: "ready",
    rejected: [],
    ...overrides,
  };
}

function activityMessage(
  activity: GenerativeUISurfaceContent,
): ActivityMessage {
  return {
    id: "m1",
    role: "activity",
    activityType: "generative-ui-surface",
    content: { ...activity },
  };
}

/** An agent of thread `threadId`, as the chat gives it to an activity. */
function agentOf(threadId: string) {
  const agent = new CapturingAgent();
  agent.agentId = "default";
  agent.threadId = threadId;
  return agent;
}

const { render: GenerativeUIChatActivity } =
  createGenerativeUIActivityRenderer();

/** What a `#generative-ui-surface` slot got. */
const seen: Array<{ cause: unknown; rejected: unknown }> = [];

/** A consumer card: records its props and renders the surface. */
const Wrapper = defineComponent({
  props: {
    surfaceId: { type: String, required: true },
    isStreaming: { type: Boolean, required: true },
    error: { type: Error, default: undefined },
    rejected: {
      type: Array as PropType<GenerativeUIRejectedOperation[]>,
      required: true,
    },
    children: { type: Object as PropType<VNode | null>, default: null },
  },
  setup(props) {
    watchEffect(() => {
      seen.push({ cause: props.error?.cause, rejected: props.rejected });
    });
    return {};
  },
  template: `
    <div data-testid="custom-wrapper" :data-surface="surfaceId">
      <component :is="children" />
    </div>
  `,
});

/**
 * Gives its `#generative-ui-surface` slot to the chat surfaces below it, the
 * way `CopilotChat` does.
 */
const ChatSlotHost = defineComponent({
  setup(_props, { slots }) {
    provide(
      GenerativeUIChatSlotKey,
      computed(() => slots["generative-ui-surface"]),
    );
    return {};
  },
  template: "<slot />",
});

/**
 * Renders the activity renderer for `activity` of an agent in thread t1,
 * with a stub runtime. `chatThreadId` puts it under a chat configuration
 * with that thread; `withSlot` under a `#generative-ui-surface` slot.
 */
function renderActivity(
  activity: GenerativeUISurfaceContent,
  {
    chatThreadId,
    withSlot = false,
  }: { chatThreadId?: string; withSlot?: boolean } = {},
) {
  const { runtime } = createTestRuntime(ui);
  const Provider = createRuntimeProvider(runtime);
  const activityTemplate = `
    <GenerativeUIChatActivity
      activity-type="generative-ui-surface"
      :content="activity"
      :message="message"
      :agent="agent"
    />
  `;
  const slotted = withSlot
    ? `<ChatSlotHost>
         <template #generative-ui-surface="slotProps">
           <Wrapper v-bind="slotProps" />
         </template>
         ${activityTemplate}
       </ChatSlotHost>`
    : activityTemplate;
  const configured = chatThreadId
    ? `<CopilotChatConfigurationProvider :thread-id="chatThreadId">${slotted}</CopilotChatConfigurationProvider>`
    : slotted;
  const Host = defineComponent({
    components: {
      Provider,
      GenerativeUIChatActivity,
      ChatSlotHost,
      Wrapper,
      CopilotChatConfigurationProvider,
    },
    setup: () => ({
      activity,
      message: activityMessage(activity),
      agent: agentOf("t1"),
      chatThreadId,
    }),
    template: `<Provider>${configured}</Provider>`,
  });
  render(Host);
  return { runtime };
}

const chatSurfaces = () =>
  document.querySelectorAll<HTMLElement>("[data-generative-ui-chat-surface]");

// The chat card through CopilotChat (render, error note, custom card) is
// covered by the provider wiring; this is the one case the chat tests do
// not reach.
describe("GenerativeUIChatActivity", () => {
  it("renders nothing in the chat for a surface of a named target", () => {
    const { runtime } = renderActivity(content("s2", "side"));
    expect(runtime.manager.getSurface("t1", "s2")).toBeDefined();
    expect(chatSurfaces()).toHaveLength(0);
  });
});

describe("GenerativeUIChatActivity (Vue-specific semantics)", () => {
  it("ingests the content before it renders, and shows a chat surface in the default card", () => {
    renderActivity(content("s1", "chat"));

    expect(chatSurfaces()).toHaveLength(1);
    expect(chatSurfaces()[0].dataset.generativeUiChatSurface).toBe("s1");
    expect(within(chatSurfaces()[0]).getByText("Hi")).toBeTruthy();
    expect(within(chatSurfaces()[0]).queryByRole("alert")).toBeNull();
  });

  it("shows the error line of the default card while the content has rejections", () => {
    renderActivity(
      content("s1", "chat", {
        rejected: [{ index: 2, reason: 'component "p3": unknown prop' }],
      }),
    );

    expect(within(chatSurfaces()[0]).getByRole("alert").textContent).toBe(
      "Part of this UI couldn't be shown.",
    );
    expect(chatSurfaces()[0].textContent).not.toContain("unknown prop");
    expect(within(chatSurfaces()[0]).getByText("Hi")).toBeTruthy();
  });

  it("shows only the error when the createSurface itself is rejected", () => {
    const rejectedCreate: A2UIOperation = {
      version: "1.0",
      createSurface: {
        surfaceId: "s1",
        catalogId: ui.id,
        components: [{ id: "root", component: "Nope" }],
      },
    };
    renderActivity(content("s1", "chat", { operations: [rejectedCreate] }));

    expect(within(chatSurfaces()[0]).getByRole("alert").textContent).toBe(
      "Part of this UI couldn't be shown.",
    );
    expect(
      chatSurfaces()[0].querySelector("[data-generative-ui-root]"),
    ).toBeNull();
  });

  it("gives the #generative-ui-surface slot the raw rejection list and the surface", () => {
    seen.length = 0;
    const reason = 'component "p3": unknown prop "category"';
    renderActivity(
      content("s1", "chat", { rejected: [{ index: 1, reason }] }),
      { withSlot: true },
    );

    const expected = [{ index: 1, reason }];
    expect(seen.at(-1)).toEqual({ cause: expected, rejected: expected });
    const wrapper = screen.getByTestId("custom-wrapper");
    expect(wrapper.dataset.surface).toBe("s1");
    expect(within(wrapper).getByText("Hi")).toBeTruthy();
    expect(chatSurfaces()).toHaveLength(0);
  });

  it("reads the thread of the chat configuration before the thread of the agent", () => {
    const { runtime } = renderActivity(content("s1", "chat"), {
      chatThreadId: "chat-thread",
    });

    expect(runtime.manager.getSurface("chat-thread", "s1")).toBeDefined();
    expect(runtime.manager.getSurface("t1", "s1")).toBeUndefined();
    expect(chatSurfaces()).toHaveLength(1);
  });
});

describe("createGenerativeUIFunctionCallActivityRenderer", () => {
  it("renders nothing for a function-call activity", () => {
    const { render: FunctionCall } =
      createGenerativeUIFunctionCallActivityRenderer();
    const Host = defineComponent({
      components: { FunctionCall },
      template: `<div data-testid="host"><FunctionCall /></div>`,
    });
    render(Host);
    expect(screen.getByTestId("host").textContent).toBe("");
    expect(screen.getByTestId("host").children).toHaveLength(0);
  });
});

describe("registerGenerativeUIToolCallRenderer", () => {
  function setup() {
    const core = new CopilotKitCoreVue({});
    const other = defineToolCallRenderer({
      name: "search",
      args: z.any(),
      render: () => null,
    });
    const previous = defineToolCallRenderer({
      name: "render_ui",
      args: z.any(),
      render: () => "old",
    });
    core.setRenderToolCalls([other, previous]);
    const enabled = ref(true);
    const scope = effectScope();
    scope.run(() =>
      registerGenerativeUIToolCallRenderer(
        shallowRef(core),
        () => enabled.value,
      ),
    );
    return { core, other, previous, enabled, scope };
  }

  it("replaces the render_ui renderer and keeps the others", () => {
    const { core, other, previous } = setup();

    const names = core.propRenderToolCalls.map((entry) => entry.name);
    expect(names).toEqual(["search", "render_ui"]);
    expect(core.propRenderToolCalls[0]).toBe(other);
    expect(core.propRenderToolCalls[1]).not.toBe(previous);
  });

  it("renders nothing for a render_ui tool call", () => {
    const { core } = setup();
    const RenderUI = core.propRenderToolCalls[1].render;
    const Host = defineComponent({
      components: { RenderUI },
      template: `<div data-testid="host"><RenderUI /></div>`,
    });
    render(Host);
    expect(screen.getByTestId("host").textContent).toBe("");
  });

  it("removes the renderer when it is disabled and when the scope is disposed", async () => {
    const { core, enabled, scope } = setup();

    enabled.value = false;
    await nextTick();
    expect(core.propRenderToolCalls.map((entry) => entry.name)).toEqual([
      "search",
    ]);

    enabled.value = true;
    await nextTick();
    expect(core.propRenderToolCalls.map((entry) => entry.name)).toEqual([
      "search",
      "render_ui",
    ]);

    scope.stop();
    expect(core.propRenderToolCalls.map((entry) => entry.name)).toEqual([
      "search",
    ]);
  });
});
