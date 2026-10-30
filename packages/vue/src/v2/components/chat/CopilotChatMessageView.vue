<script setup lang="ts">
import { computed, h, onMounted, provide, ref, useSlots, watch } from "vue";
import type { Component, FunctionalComponent, VNode, VNodeChild } from "vue";
import type {
  ActivityMessage,
  AssistantMessage,
  Message,
  ReasoningMessage,
  ToolMessage,
  UserMessage,
} from "@ag-ui/core";
import {
  DEFAULT_AGENT_ID,
  commitRowKeyStore,
  createRowKeyStore,
  resolveRowRenderKeysById,
} from "@copilotkit/shared";
import {
  ɵdeduplicateMessages,
  ɵgetToolCallLayouts,
  ɵgetToolCallRendererNames,
  ɵgetTurnWork,
  ɵgetWorkOpenState,
  ɵisTurnWorkOpen,
  ɵisTurnWorking,
  ɵrecordWorkTime,
  ɵresolveActivityRenderer,
  ɵresolveCustomMessageRenderers,
  ɵgetLatestTurnKey,
} from "@copilotkit/core";
import type {
  CopilotChatToolCallDisplay,
  ToolCallEntry,
  ɵToolCallDisplayContextValue,
  ɵToolCallLayout,
  ɵTurnWork,
  ɵWorkTime,
} from "@copilotkit/core";
import type {
  InterruptRenderProps,
  VueCustomMessageRendererProps,
} from "../../types";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import CopilotChatAssistantMessage from "./CopilotChatAssistantMessage.vue";
import CopilotChatReasoningMessage from "./CopilotChatReasoningMessage.vue";
import CopilotChatUserMessage from "./CopilotChatUserMessage.vue";
import CopilotChatWorkSummary from "./CopilotChatWorkSummary.vue";
import { CopilotChatCollapsible } from "./tool-call-group-parts";
import { TurnWorkFold } from "./turn-work";
import {
  MessageFeedbackScopeKey,
  useLearningFeedbackEnabled,
} from "./message-feedback";
import type { MessageFeedbackScope } from "./message-feedback";
import { ToolCallDisplayContextKey } from "./tool-call-display-context";
import type { CopilotChatWorkSummarySlotProps } from "./types";

interface MessageMetaProps {
  message: Message;
  position: "before" | "after";
  runId: string;
  messageIndex: number;
  messageIndexInRun: number;
  numberOfMessagesInRun: number;
  agentId: string;
  stateSnapshot: unknown;
}

interface ActivitySlotProps {
  activityType: string;
  content: unknown;
  message: ActivityMessage;
  agent: unknown;
}

type InterruptSlotProps = InterruptRenderProps<unknown, unknown>;
type CustomMessagePosition = VueCustomMessageRendererProps["position"];
type ResolvedCustomMessageRenderer = {
  renderer:
    | Component<VueCustomMessageRendererProps>
    | ((props: VueCustomMessageRendererProps) => unknown);
  props: VueCustomMessageRendererProps;
};

const props = withDefaults(
  defineProps<{
    messages?: Message[];
    isRunning?: boolean;
    /**
     * How tool calls show. Defaults to `"grouped"`: calls made in a row
     * share one card that opens to a row per call. `"line"` and `"stacked"`
     * group them too; `"turn"` folds a reply's whole working phase into
     * "Worked for 9s" once it's done; `"separate"` gives every call its own
     * card. Calls with a renderer of their own always show on their own.
     */
    toolCallDisplay?: CopilotChatToolCallDisplay;
    /**
     * While Learning records this chat, the assistant thumbs record ratings
     * and ask for a comment. Set `false` to leave the thumbs to the app's own
     * handlers.
     */
    messageFeedback?: boolean;
  }>(),
  {
    messages: () => [],
    isRunning: false,
    toolCallDisplay: "grouped",
    messageFeedback: true,
  },
);

defineSlots<{
  "message-before"?: (props: MessageMetaProps) => unknown;
  "message-after"?: (props: MessageMetaProps) => unknown;
  interrupt?: (props: InterruptSlotProps) => unknown;
  "assistant-message"?: (props: {
    message: AssistantMessage;
    messages: Message[];
    isRunning: boolean;
  }) => unknown;
  "user-message"?: (props: { message: UserMessage }) => unknown;
  "reasoning-message"?: (props: {
    message: ReasoningMessage;
    messages: Message[];
    isRunning: boolean;
  }) => unknown;
  "activity-message"?: (props: ActivitySlotProps) => unknown;
  [key: string]: ((props: any) => unknown) | undefined;
  cursor?: () => unknown;
  /** The "Working… / Worked for 9s" line of the `"turn"` tool-call display. */
  "work-summary"?: (props: CopilotChatWorkSummarySlotProps) => unknown;
  "tool-call"?: (props: {
    name: string;
    args: unknown;
    status: string;
    result: string | undefined;
    toolCall: unknown;
    toolMessage: ToolMessage | undefined;
  }) => unknown;
  [key: `tool-call-${string}`]: (props: {
    name: string;
    args: unknown;
    status: string;
    result: string | undefined;
    toolCall: unknown;
    toolMessage: ToolMessage | undefined;
  }) => unknown;
}>();

const { copilotkit } = useCopilotKit();
const config = useCopilotChatConfiguration();
const stateTick = ref(0);
const interruptState = ref<InterruptSlotProps | null>(null);
const componentSlots = useSlots() as Record<string, (props?: any) => unknown>;
const forwardedSlotNames = computed(() => Object.keys(componentSlots));
const resolvedAgentId = computed(
  () => config.value?.agentId ?? DEFAULT_AGENT_ID,
);
const resolvedThreadAgent = computed(() => {
  // Read the registry so this recomputes when agents are added or replaced.
  void copilotkit.value.agents;
  return copilotkit.value.getAgent(resolvedAgentId.value);
});

watch(
  [
    resolvedAgentId,
    () => config.value?.threadId,
    () => copilotkit.value,
    () => copilotkit.value.runtimeConnectionStatus,
  ],
  (_values, _prev, onCleanup) => {
    const agent = resolvedThreadAgent.value;
    if (!agent) return;

    const sub = agent.subscribe({
      onStateChanged: () => {
        stateTick.value += 1;
      },
      onRunStartedEvent: () => {
        stateTick.value += 1;
      },
      onRunFinishedEvent: () => {
        stateTick.value += 1;
      },
      onRunErrorEvent: () => {
        stateTick.value += 1;
      },
    });

    onCleanup(() => sub.unsubscribe());
  },
  { immediate: true },
);

watch(
  () => copilotkit.value,
  (core, _previous, onCleanup) => {
    interruptState.value = core.interruptState as InterruptSlotProps | null;
    const sub = core.subscribe({
      onInterruptStateChanged: ({ interruptState: nextInterruptState }) => {
        interruptState.value = nextInterruptState as InterruptSlotProps | null;
      },
      onRuntimeConnectionStatusChanged: () => {
        stateTick.value += 1;
      },
    });

    onCleanup(() => sub.unsubscribe());
  },
  { immediate: true },
);

const deduplicatedMessages = computed(() =>
  ɵdeduplicateMessages(props.messages),
);

// Groups of calls can span messages (an agent often sends each call as its
// own message), so they're laid out here for the whole list and handed to
// each message's tool calls view through provide/inject.
const toolCallLayouts = computed<ReadonlyMap<string, ɵToolCallLayout>>(() =>
  props.toolCallDisplay === "separate"
    ? new Map()
    : ɵgetToolCallLayouts(
        deduplicatedMessages.value,
        props.messages,
        ɵgetToolCallRendererNames(copilotkit.value.renderToolCalls, {
          slotNames: forwardedSlotNames.value,
        }),
      ),
);
const learningFeedbackEnabled = useLearningFeedbackEnabled(copilotkit);
provide(
  MessageFeedbackScopeKey,
  computed<MessageFeedbackScope | null>(() =>
    props.messageFeedback &&
    learningFeedbackEnabled.value &&
    config.value?.agentId !== undefined &&
    config.value?.threadId !== undefined
      ? {
          copilotkit: copilotkit.value,
          agentId: config.value.agentId,
          threadId: config.value.threadId,
        }
      : null,
  ),
);

const turnWork = computed(() =>
  props.toolCallDisplay === "turn"
    ? ɵgetTurnWork(deduplicatedMessages.value, toolCallLayouts.value)
    : undefined,
);
const turnByFirstMessage = computed(() => {
  const byFirst = new Map<string, ɵTurnWork>();
  for (const turn of turnWork.value?.values() ?? []) {
    byFirst.set(turn.firstMessageId, turn);
  }
  return byFirst;
});

const lastRenderedMessage = computed(
  () => deduplicatedMessages.value[deduplicatedMessages.value.length - 1],
);
// The latest reply is keyed by the user message it answers (see getTurnWork).
const latestTurnKey = computed(() =>
  ɵgetLatestTurnKey(deduplicatedMessages.value),
);

// Work shows while the agent is on it and folds once the reply is done,
// unless the user has opened or closed it themselves.
const toggledTurns = ref<ReadonlyMap<string, boolean>>(new Map());
const turnOpenState = computed(() => ({
  toggledTurns: toggledTurns.value,
  isRunning: props.isRunning,
  latestTurnKey: latestTurnKey.value,
}));

// How long the agent worked, for "Worked for 9s". Only known for replies this
// client watched start from the user's message; a restored thread shows the
// tool count instead.
const workTimes = new Map<string, ɵWorkTime>();
const workTimesVersion = ref(0);
watch(
  [
    () => props.toolCallDisplay,
    () => props.isRunning,
    latestTurnKey,
    () => lastRenderedMessage.value?.role,
  ],
  ([display, isRunning, turnKey, lastRole]) => {
    if (display !== "turn") return;
    ɵrecordWorkTime(workTimes, {
      isRunning,
      latestTurnKey: turnKey,
      lastMessageRole: lastRole,
      now: Date.now(),
    });
    workTimesVersion.value++;
  },
  { immediate: true },
);

// Whether each working-phase message's work, and its text, shows.
const workOpenState = computed(() =>
  ɵgetWorkOpenState(turnWork.value?.values() ?? [], turnOpenState.value),
);

provide(
  ToolCallDisplayContextKey,
  computed<ɵToolCallDisplayContextValue>(() => ({
    display: props.toolCallDisplay,
    isRunning: props.isRunning,
    layouts: toolCallLayouts.value,
    workOpen: workOpenState.value.workOpen,
    workTextOpen: workOpenState.value.workTextOpen,
  })),
);

/** The `"turn"` display's summary line for a reply, or its slot. */
const WorkSummaryRow: FunctionalComponent<{
  turnKey: string;
  calls: ToolCallEntry[];
}> = ({ turnKey, calls }) => {
  void workTimesVersion.value;
  const isWorking = ɵisTurnWorking(turnKey, turnOpenState.value);
  const isOpen = ɵisTurnWorkOpen(turnKey, turnOpenState.value);
  const times = workTimes.get(turnKey);
  const summaryProps: CopilotChatWorkSummarySlotProps = {
    isWorking,
    isOpen,
    calls,
    elapsedMs: times?.elapsedMs,
    workingSince: times?.workingSince,
    onClick: () => {
      toggledTurns.value = new Map(toggledTurns.value).set(turnKey, !isOpen);
    },
  };
  const slot = componentSlots["work-summary"];
  return h(
    CopilotChatCollapsible,
    { open: isWorking || calls.length > 0 },
    () => [
      h(
        "div",
        { class: "cpk-message-view-work-summary" },
        slot
          ? (slot(summaryProps) as VNode[])
          : [h(CopilotChatWorkSummary, summaryProps)],
      ),
    ],
  );
};
WorkSummaryRow.props = ["turnKey", "calls"];

// Stable per-row keys. Backends can re-key a message mid-stream, and keying
// rows by the canonical id tears the row down on that swap (the HITL chat
// flash). See @copilotkit/shared row-render-keys for the mechanism.
const rowKeyStore = createRowKeyStore();
const rowRenderKeys = computed(() =>
  resolveRowRenderKeysById(rowKeyStore, deduplicatedMessages.value),
);

// Record what the DOM was patched with, never what a computed merely
// evaluated: an anchor from an evaluation Vue never patches would re-key a
// rendered row and tear it down.
onMounted(() => commitRowKeyStore(rowKeyStore, deduplicatedMessages.value));
watch(
  deduplicatedMessages,
  (messages) => commitRowKeyStore(rowKeyStore, messages),
  { flush: "post" },
);
const lastMessage = computed(() => props.messages[props.messages.length - 1]);
// In the "turn" display the "Working" line at the top of the reply is the
// progress indicator; before the reply's first message it sits where the
// cursor would.
const showCursor = computed(
  () =>
    props.isRunning &&
    lastMessage.value?.role !== "reasoning" &&
    props.toolCallDisplay !== "turn",
);
const pendingWorkSummary = computed(
  () =>
    props.toolCallDisplay === "turn" &&
    props.isRunning &&
    lastRenderedMessage.value?.role === "user",
);

watch(
  [() => props.messages.length, () => deduplicatedMessages.value.length],
  ([messageCount, deduplicatedCount]) => {
    if (
      process.env.NODE_ENV === "development" &&
      deduplicatedCount < messageCount
    ) {
      console.warn(
        `CopilotChatMessageView: Deduplicated ${messageCount - deduplicatedCount} message(s) with duplicate IDs.`,
      );
    }
  },
  { immediate: true },
);

function getMeta(
  message: Message,
): Omit<MessageMetaProps, "position" | "message"> {
  stateTick.value += 0;
  const agentId = resolvedAgentId.value;
  const threadId = config.value?.threadId ?? "";
  const core = copilotkit.value;

  const resolvedRunId =
    core.getRunIdForMessage(agentId, threadId, message.id) ??
    core.getRunIdsForThread(agentId, threadId).slice(-1)[0];
  const runId = resolvedRunId ?? `missing-run-id:${message.id}`;

  const agent = resolvedThreadAgent.value ?? core.getAgent(agentId);

  const messageIdsInRun =
    resolvedRunId && agent
      ? agent.messages
          .filter(
            (msg) =>
              core.getRunIdForMessage(agentId, threadId, msg.id) ===
              resolvedRunId,
          )
          .map((msg) => msg.id)
      : [message.id];

  const rawMessageIndex = agent
    ? agent.messages.findIndex((msg) => msg.id === message.id)
    : -1;
  const messageIndex = rawMessageIndex >= 0 ? rawMessageIndex : 0;
  const messageIndexInRun = resolvedRunId
    ? Math.max(messageIdsInRun.indexOf(message.id), 0)
    : 0;
  const numberOfMessagesInRun = resolvedRunId ? messageIdsInRun.length : 1;

  // `getStateByRun` deep-clones the whole run state, so resolve it only when
  // a consumer reads `stateSnapshot`, and at most once per meta object.
  let stateSnapshot: unknown;
  let stateSnapshotResolved = false;

  return {
    runId,
    messageIndex,
    messageIndexInRun,
    numberOfMessagesInRun,
    agentId,
    get stateSnapshot() {
      if (!stateSnapshotResolved) {
        stateSnapshotResolved = true;
        stateSnapshot = resolvedRunId
          ? core.getStateByRun(agentId, threadId, resolvedRunId)
          : undefined;
      }
      return stateSnapshot;
    },
  };
}

// `Object.assign` onto the meta object keeps the lazy `stateSnapshot` getter.
// A spread would call it.
function getMessageSlotProps(
  message: Message,
  position: MessageMetaProps["position"],
): MessageMetaProps {
  return Object.assign(getMeta(message), { message, position });
}

// Calls a `#message-before` / `#message-after` slot with the meta object
// itself. A template `<slot v-bind>` inside `v-for` goes through
// `mergeProps`, which reads every key and so would clone the run state for
// slots that never read `stateSnapshot`.
const MessageMetaSlot: FunctionalComponent<{
  render: (props: MessageMetaProps) => unknown;
  slotProps: MessageMetaProps;
}> = ({ render, slotProps }) => render(slotProps) as VNodeChild;
MessageMetaSlot.props = ["render", "slotProps"];

function getActivitySlotName(activityType: string): `activity-${string}` {
  return `activity-${activityType}`;
}

function resolveCustomMessageRenderer(
  message: Message,
  position: CustomMessagePosition,
): ResolvedCustomMessageRenderer | null {
  stateTick.value += 0;
  const slotName = position === "before" ? "message-before" : "message-after";
  if (componentSlots[slotName]) {
    return null;
  }

  // Try each renderer in order and use the first that has something to draw.
  const selected = ɵresolveCustomMessageRenderers(
    copilotkit.value.renderCustomMessages,
    resolvedAgentId.value,
  ).find((renderer) => renderer.render);
  if (!selected) {
    return null;
  }

  return {
    renderer: selected.render as ResolvedCustomMessageRenderer["renderer"],
    props: getMessageSlotProps(message, position),
  };
}

function resolveActivityRenderer(
  message: ActivityMessage,
): { renderer: Component; props: ActivitySlotProps } | null {
  stateTick.value += 0;

  const match = ɵresolveActivityRenderer(
    copilotkit.value.renderActivityMessages,
    {
      activityType: message.activityType,
      agentId: resolvedAgentId.value,
      content: message.content,
    },
  );
  if (!match) return null;

  return {
    renderer: match.renderer.render as Component,
    props: {
      activityType: message.activityType,
      content: match.content,
      message,
      agent: resolvedThreadAgent.value,
    },
  };
}
</script>

<template>
  <div
    data-copilotkit
    class="copilotKitMessages cpk-message-view"
    v-bind="$attrs"
  >
    <template
      v-for="message in deduplicatedMessages"
      :key="rowRenderKeys.get(message.id) ?? message.id"
    >
      <WorkSummaryRow
        v-if="turnByFirstMessage.get(message.id)"
        :turn-key="turnByFirstMessage.get(message.id)!.key"
        :calls="turnByFirstMessage.get(message.id)!.calls"
      />
      <MessageMetaSlot
        v-if="componentSlots['message-before']"
        :render="componentSlots['message-before']"
        :slot-props="getMessageSlotProps(message, 'before')"
      />
      <component
        v-else-if="resolveCustomMessageRenderer(message, 'before')"
        :is="resolveCustomMessageRenderer(message, 'before')!.renderer"
        v-bind="resolveCustomMessageRenderer(message, 'before')!.props"
      />

      <slot
        v-if="message.role === 'assistant'"
        name="assistant-message"
        :message="message"
        :messages="messages"
        :is-running="isRunning"
      >
        <CopilotChatAssistantMessage
          :message="message"
          :messages="messages"
          :is-running="isRunning"
        >
          <template
            v-for="slotName in forwardedSlotNames"
            :key="slotName"
            #[slotName]="slotProps"
          >
            <slot :name="slotName" v-bind="slotProps" />
          </template>
        </CopilotChatAssistantMessage>
      </slot>

      <slot
        v-else-if="message.role === 'user'"
        name="user-message"
        :message="message"
      >
        <CopilotChatUserMessage :message="message">
          <template
            v-for="slotName in forwardedSlotNames"
            :key="slotName"
            #[slotName]="slotProps"
          >
            <slot :name="slotName" v-bind="slotProps" />
          </template>
        </CopilotChatUserMessage>
      </slot>

      <!-- Reasoning during a reply's working phase folds away with the work.
           Always wrapped in this display, so reasoning that turns into work
           keeps its node (and its "Thought for" timer) instead of remounting. -->
      <TurnWorkFold
        v-else-if="message.role === 'reasoning'"
        :open="
          toolCallDisplay === 'turn'
            ? (workOpenState.workOpen.get(message.id) ?? true)
            : undefined
        "
      >
        <slot
          name="reasoning-message"
          :message="message"
          :messages="messages"
          :is-running="isRunning"
        >
          <CopilotChatReasoningMessage
            :message="message"
            :messages="messages"
            :is-running="isRunning"
          />
        </slot>
      </TurnWorkFold>

      <slot
        v-else-if="message.role === 'activity'"
        :name="getActivitySlotName(message.activityType)"
        :activity-type="message.activityType"
        :content="message.content"
        :message="message"
        :agent="resolvedThreadAgent"
      >
        <slot
          name="activity-message"
          :activity-type="message.activityType"
          :content="message.content"
          :message="message"
          :agent="resolvedThreadAgent"
        >
          <component
            v-if="resolveActivityRenderer(message)"
            :is="resolveActivityRenderer(message)!.renderer"
            v-bind="resolveActivityRenderer(message)!.props"
          />
        </slot>
      </slot>

      <MessageMetaSlot
        v-if="componentSlots['message-after']"
        :render="componentSlots['message-after']"
        :slot-props="getMessageSlotProps(message, 'after')"
      />
      <component
        v-else-if="resolveCustomMessageRenderer(message, 'after')"
        :is="resolveCustomMessageRenderer(message, 'after')!.renderer"
        v-bind="resolveCustomMessageRenderer(message, 'after')!.props"
      />
    </template>

    <slot
      v-if="interruptState"
      name="interrupt"
      :event="interruptState.event"
      :interrupt="interruptState.interrupt"
      :interrupts="interruptState.interrupts"
      :result="interruptState.result"
      :resolve="interruptState.resolve"
      :cancel="interruptState.cancel"
    />

    <WorkSummaryRow
      v-if="pendingWorkSummary"
      :turn-key="latestTurnKey"
      :calls="[]"
    />

    <div v-if="showCursor" class="cpk-message-view-cursor-container">
      <slot name="cursor">
        <div
          class="cpk-message-view-cursor"
          data-testid="copilot-loading-cursor"
        />
      </slot>
    </div>
  </div>
</template>
