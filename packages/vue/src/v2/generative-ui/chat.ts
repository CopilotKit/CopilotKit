import { computed, defineComponent, h, inject, watch } from "vue";
import type {
  Component,
  InjectionKey,
  PropType,
  Ref,
  ShallowRef,
  Slot,
  VNode,
} from "vue";
import type { AbstractAgent } from "@ag-ui/client";
import type { ActivityMessage } from "@ag-ui/core";
import { z } from "zod";
import {
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_CHAT_TARGET,
  GENERATIVE_UI_FUNCTION_CALL_ACTIVITY_TYPE,
  GENERATIVE_UI_RENDER_TOOL,
} from "@copilotkit/shared";
import type {
  GenerativeUIRejectedOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import type { ManagedSurface } from "@copilotkit/core/generative-ui";
import type { CopilotKitCoreVue } from "../lib/vue-core";
import { useCopilotChatConfiguration } from "../providers/useCopilotChatConfiguration";
import { defineToolCallRenderer } from "../types/defineToolCallRenderer";
import DefaultGenerativeUIChatCard from "./DefaultGenerativeUIChatCard.vue";
import { useManagerVersion } from "./hooks";
import { useGenerativeUIRuntime } from "./runtime-context";
import { SurfaceView } from "./SurfaceView";

/**
 * Experimental. The props of the card around a surface in the chat:
 * `DefaultGenerativeUIChatCard` gets them, and so does the
 * `#generative-ui-surface` slot of `CopilotChat` (see
 * {@link GenerativeUIChatSurfaceSlotProps}).
 */
export interface GenerativeUIChatSurfaceProps {
  surfaceId: string;
  isStreaming: boolean;
  /**
   * Set when operations from the latest render_ui call were rejected. The
   * message is user-facing; `error.cause` holds the same list as `rejected`.
   */
  error?: Error;
  /** Rejected operations from the latest render_ui call, with validator reasons. */
  rejected: GenerativeUIRejectedOperation[];
}

/**
 * Experimental. The props of the `#generative-ui-surface` slot of
 * `CopilotChat`: the card props, plus the rendered surface.
 *
 * @example
 * ```vue
 * <CopilotChat>
 *   <template #generative-ui-surface="{ error, children }">
 *     <MyCard :error="error">
 *       <component :is="children" />
 *     </MyCard>
 *   </template>
 * </CopilotChat>
 * ```
 */
export interface GenerativeUIChatSurfaceSlotProps extends GenerativeUIChatSurfaceProps {
  /**
   * The surface, as a VNode. Render it with `<component :is="children" />`.
   * `null` when the createSurface of the surface was rejected, so the card
   * shows only the error.
   */
  children: VNode | null;
}

/** The `#generative-ui-surface` slot function of `CopilotChat`. */
export type GenerativeUIChatSurfaceSlot =
  Slot<GenerativeUIChatSurfaceSlotProps>;

/**
 * Where `CopilotChat` gives its `#generative-ui-surface` slot to the chat
 * surfaces below it. The value is a ref of the slot function, `undefined`
 * when the consumer left the slot out; the surfaces then use their default
 * card. `CopilotChat` provides it as:
 *
 * ```ts
 * const slots = useSlots();
 * provide(GenerativeUIChatSlotKey, computed(() => slots["generative-ui-surface"]));
 * ```
 *
 * The slot is called with {@link GenerativeUIChatSurfaceSlotProps}, for the
 * surfaces of the tool transport and of the markdown transport.
 */
export const GenerativeUIChatSlotKey: InjectionKey<
  Readonly<Ref<GenerativeUIChatSurfaceSlot | undefined>>
> = Symbol("GenerativeUIChatSlot");

const noSlot = computed<GenerativeUIChatSurfaceSlot | undefined>(
  () => undefined,
);

/**
 * @internal
 * One chat surface in the `#generative-ui-surface` slot of `CopilotChat`, or
 * in `card` when there is no slot. Both lists in `rejected` cover only the
 * latest render_ui call (see the manager's ingest). A slot gets the detailed
 * reasons (`rejected`, `error.cause`); the default cards show a generic
 * message.
 */
export const GenerativeUIChatSurfaceOutlet = defineComponent({
  name: "GenerativeUIChatSurfaceOutlet",
  props: {
    surface: { type: Object as PropType<ManagedSurface>, required: true },
    isStreaming: { type: Boolean, required: true },
    rejected: {
      type: Array as PropType<GenerativeUIRejectedOperation[]>,
      required: true,
    },
    /** The card when the consumer has no `#generative-ui-surface` slot. */
    card: { type: Object as PropType<Component>, required: true },
  },
  setup(props) {
    const slot = inject(GenerativeUIChatSlotKey, noSlot);
    return () => {
      const { surface, rejected } = props;
      const cardProps: GenerativeUIChatSurfaceProps = {
        surfaceId: surface.surfaceId,
        isStreaming: props.isStreaming,
        error:
          rejected.length > 0
            ? new Error(`${rejected.length} UI update(s) could not be shown`, {
                cause: rejected,
              })
            : undefined,
        rejected,
      };
      // A surface whose createSurface was rejected shows only the error.
      const children = surface.failed ? null : h(SurfaceView, { surface });
      const custom = slot.value;
      if (custom) return custom({ ...cardProps, children });
      return h(props.card, cardProps, { default: () => children });
    };
  },
});

const ContentSchema = z
  .object({
    surfaceId: z.string(),
    target: z.string(),
    catalogId: z.string(),
    operations: z.array(z.any()),
    status: z.enum(["streaming", "ready", "error"]),
    rejected: z
      .array(z.object({ index: z.number(), reason: z.string() }))
      .default([]),
  })
  .passthrough();

/**
 * Renders a surface activity of the tool transport in the chat: it ingests
 * the operations into the manager before it renders, and shows a surface of
 * the chat target in the chat card. A surface for a named target renders in
 * its `<GenerativeUISurface>` instead.
 */
const GenerativeUIChatActivity = defineComponent({
  name: "GenerativeUIChatActivity",
  props: {
    activityType: { type: String, required: true },
    content: {
      type: Object as PropType<GenerativeUISurfaceContent>,
      required: true,
    },
    message: { type: Object as PropType<ActivityMessage>, required: true },
    agent: { type: Object as PropType<AbstractAgent>, default: undefined },
  },
  setup(props) {
    const runtime = useGenerativeUIRuntime();
    const chat = useCopilotChatConfiguration();
    const version = useManagerVersion(runtime);
    // Read on each use: the agent object is not reactive.
    const threadIdOf = () => chat.value?.threadId ?? props.agent?.threadId;
    watch(
      [runtime, () => props.content, threadIdOf, () => props.agent?.agentId],
      ([current, content, threadId, agentId]) => {
        if (current && threadId) {
          current.manager.ingest(threadId, agentId, content);
        }
      },
      { immediate: true },
    );
    const card = computed(() => {
      void version.value;
      const current = runtime.value;
      const threadId = threadIdOf();
      const content = props.content;
      const isChatSurface = content.target === GENERATIVE_UI_CHAT_TARGET;
      if (!current || !threadId || !isChatSurface) return null;
      const surface =
        current.manager.getSurface(threadId, content.surfaceId) ??
        current.manager.getFailedSurface(threadId, content.surfaceId);
      if (!surface) return null;
      return {
        surface,
        isStreaming: content.status === "streaming",
        rejected: [...content.rejected, ...surface.clientRejected],
      };
    });
    return () =>
      card.value &&
      h(GenerativeUIChatSurfaceOutlet, {
        ...card.value,
        card: DefaultGenerativeUIChatCard,
      });
  },
});

/**
 * The activity renderer of `generative-ui-surface` messages, for the
 * built-in activity renderers of `CopilotKitProvider`. It renders the
 * surfaces of the chat target in the chat card, or in the
 * `#generative-ui-surface` slot of `CopilotChat`.
 */
export function createGenerativeUIActivityRenderer() {
  return {
    activityType: GENERATIVE_UI_ACTIVITY_TYPE,
    content: ContentSchema,
    render: GenerativeUIChatActivity,
  };
}

/**
 * Shows nothing in the chat for an agent-called function. The root reads the
 * function-call activities from the messages and runs them. This renderer
 * only keeps a wildcard ("*") activity renderer from showing them.
 */
export function createGenerativeUIFunctionCallActivityRenderer() {
  return {
    activityType: GENERATIVE_UI_FUNCTION_CALL_ACTIVITY_TYPE,
    content: z.unknown(),
    render: () => null,
  };
}

/**
 * Registers a renderer for the `render_ui` tool call that renders nothing:
 * the surface activity owns the UX. Registering it still keeps a wildcard
 * tool renderer from showing the raw arguments. It goes through
 * `setRenderToolCalls`, so a `useRenderTool({ name: "render_ui" })` of the
 * app wins.
 *
 * Call it from the provider's setup. The renderer is replaced when the core
 * instance changes, and removed when `enabled` turns false or the effect
 * scope is disposed.
 *
 * @param copilotkit - The core instance of the provider.
 * @param enabled - True while the provider has a `generativeUI` config.
 */
export function registerGenerativeUIToolCallRenderer(
  copilotkit: ShallowRef<CopilotKitCoreVue>,
  enabled: () => boolean,
) {
  watch(
    [() => copilotkit.value, enabled],
    ([core, isEnabled], _previous, onCleanup) => {
      if (!isEnabled) return;
      const renderer = defineToolCallRenderer({
        name: GENERATIVE_UI_RENDER_TOOL,
        args: z.any(),
        render: () => null,
      });
      const withoutRenderTool = () =>
        core.propRenderToolCalls.filter(
          (entry) => entry.name !== GENERATIVE_UI_RENDER_TOOL,
        );
      core.setRenderToolCalls([...withoutRenderTool(), renderer]);
      onCleanup(() => core.setRenderToolCalls(withoutRenderTool()));
    },
    { immediate: true },
  );
}
