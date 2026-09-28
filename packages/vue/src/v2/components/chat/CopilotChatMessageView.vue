<script setup lang="ts">
import {
  computed,
  inject,
  onMounted,
  provide,
  ref,
  useSlots,
  watch,
} from "vue";
import type { Component } from "vue";
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
import type {
  InterruptRenderProps,
  VueCustomMessageRendererProps,
} from "../../types";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import CopilotChatAssistantMessage from "./CopilotChatAssistantMessage.vue";
import CopilotChatReasoningMessage from "./CopilotChatReasoningMessage.vue";
import CopilotChatUserMessage from "./CopilotChatUserMessage.vue";
import CopilotChatSubagentGroup, {
  SubagentLayoutKey,
} from "./CopilotChatSubagentGroup";
import { ɵbuildSubagentLayout } from "@copilotkit/core";
import type { ɵSubagentGroup } from "@copilotkit/core";
import { useSubagents } from "../../hooks/use-subagents";
import type { CopilotChatSubagentSlotProps } from "./types";

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
     * @internal Set by a subagent group to render that group's messages
     * with this view. Application code does not pass it.
     */
    subagentGroup?: ɵSubagentGroup;
  }>(),
  {
    messages: () => [],
    isRunning: false,
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
  subagent?: (props: CopilotChatSubagentSlotProps) => unknown;
  [key: string]: ((props: any) => unknown) | undefined;
  cursor?: () => unknown;
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

function deduplicateMessages(messages: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const message of messages) {
    const existing = byId.get(message.id);
    if (
      existing &&
      message.role === "assistant" &&
      existing.role === "assistant"
    ) {
      const content = message.content || existing.content;
      const toolCalls = message.toolCalls ?? existing.toolCalls;
      byId.set(message.id, {
        ...existing,
        ...message,
        content,
        toolCalls,
      } as AssistantMessage);
    } else {
      byId.set(message.id, message);
    }
  }
  return [...byId.values()];
}

const deduplicatedMessages = computed(() =>
  deduplicateMessages(props.messages),
);

// Messages a subagent produced leave the main list and render as groups:
// under the tool call that started them, inside a parent group, or where their
// first message was. A group body reuses this view over the group's messages
// and reads the layout the top view provides.
const parentSubagentLayout = inject(SubagentLayoutKey, null);
const subagents = useSubagents();
const ownSubagentLayout = computed(() =>
  ɵbuildSubagentLayout(deduplicatedMessages.value, subagents.value),
);
const subagentLayout = computed(() =>
  props.subagentGroup && parentSubagentLayout
    ? parentSubagentLayout.value.layout
    : ownSubagentLayout.value,
);
const rows = computed(() =>
  props.subagentGroup
    ? props.subagentGroup.messages
    : ownSubagentLayout.value.topLevel,
);
const slots = useSlots();
if (!props.subagentGroup) {
  provide(
    SubagentLayoutKey,
    computed(() => ({
      layout: ownSubagentLayout.value,
      messages: props.messages,
      isRunning: props.isRunning,
      slots,
    })),
  );
}

function groupsAfter(messageId: string | null) {
  if (props.subagentGroup) return [];
  return subagentLayout.value.afterMessageId.get(messageId) ?? [];
}

const nestedGroups = computed(() =>
  props.subagentGroup
    ? (subagentLayout.value.bySubagentRunId.get(
        props.subagentGroup.subagentRunId,
      ) ?? [])
    : [],
);

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
const showCursor = computed(
  () => props.isRunning && lastMessage.value?.role !== "reasoning",
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
  const stateSnapshot = resolvedRunId
    ? core.getStateByRun(agentId, threadId, resolvedRunId)
    : undefined;

  return {
    runId,
    messageIndex,
    messageIndexInRun,
    numberOfMessagesInRun,
    agentId,
    stateSnapshot,
  };
}

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

  const agentId = resolvedAgentId.value;
  const renderers = [...copilotkit.value.renderCustomMessages]
    .filter(
      (renderer) =>
        renderer.agentId === undefined || renderer.agentId === agentId,
    )
    .sort((a, b) => {
      const aHasAgent = a.agentId !== undefined;
      const bHasAgent = b.agentId !== undefined;
      if (aHasAgent === bHasAgent) return 0;
      return aHasAgent ? -1 : 1;
    });

  const selected = renderers[0];
  if (!selected?.render) {
    return null;
  }

  return {
    renderer: selected.render as ResolvedCustomMessageRenderer["renderer"],
    props: {
      ...getMeta(message),
      message,
      position,
    },
  };
}

function resolveActivityRenderer(
  message: ActivityMessage,
): { renderer: Component; props: ActivitySlotProps } | null {
  stateTick.value += 0;

  const agentId = resolvedAgentId.value;
  const renderer = [...copilotkit.value.renderActivityMessages]
    .filter(
      (entry) =>
        entry.activityType === message.activityType &&
        (entry.agentId === undefined || entry.agentId === agentId),
    )
    .sort((a, b) => {
      const aScoped = a.agentId !== undefined;
      const bScoped = b.agentId !== undefined;
      if (aScoped === bScoped) return 0;
      return aScoped ? -1 : 1;
    })[0];

  if (!renderer) return null;
  const parsed = renderer.content.safeParse(message.content);
  if (!parsed.success) return null;

  return {
    renderer: renderer.render as Component,
    props: {
      activityType: message.activityType,
      content: parsed.data,
      message,
      agent: resolvedThreadAgent.value,
    },
  };
}

function resolveToolMessage(
  message: Message,
  toolCallId: string,
): ToolMessage | undefined {
  return props.messages.find(
    (candidate) =>
      candidate.role === "tool" &&
      (candidate as ToolMessage).toolCallId === toolCallId,
  ) as ToolMessage | undefined;
}
</script>

<template>
  <div data-copilotkit class="cpk:flex cpk:flex-col" v-bind="$attrs">
    <CopilotChatSubagentGroup
      v-for="group in groupsAfter(null)"
      :key="`subagent-${group.subagentRunId}`"
      :group="group"
    />
    <template
      v-for="message in rows"
      :key="rowRenderKeys.get(message.id) ?? message.id"
    >
      <slot
        v-if="componentSlots['message-before']"
        name="message-before"
        :message="message"
        position="before"
        :run-id="getMeta(message).runId"
        :message-index="getMeta(message).messageIndex"
        :message-index-in-run="getMeta(message).messageIndexInRun"
        :number-of-messages-in-run="getMeta(message).numberOfMessagesInRun"
        :agent-id="getMeta(message).agentId"
        :state-snapshot="getMeta(message).stateSnapshot"
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

      <slot
        v-else-if="message.role === 'reasoning'"
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

      <slot
        v-if="componentSlots['message-after']"
        name="message-after"
        :message="message"
        position="after"
        :run-id="getMeta(message).runId"
        :message-index="getMeta(message).messageIndex"
        :message-index-in-run="getMeta(message).messageIndexInRun"
        :number-of-messages-in-run="getMeta(message).numberOfMessagesInRun"
        :agent-id="getMeta(message).agentId"
        :state-snapshot="getMeta(message).stateSnapshot"
      />
      <component
        v-else-if="resolveCustomMessageRenderer(message, 'after')"
        :is="resolveCustomMessageRenderer(message, 'after')!.renderer"
        v-bind="resolveCustomMessageRenderer(message, 'after')!.props"
      />
      <CopilotChatSubagentGroup
        v-for="group in groupsAfter(message.id)"
        :key="`subagent-${group.subagentRunId}`"
        :group="group"
      />
    </template>
    <CopilotChatSubagentGroup
      v-for="group in nestedGroups"
      :key="`subagent-${group.subagentRunId}`"
      :group="group"
    />

    <slot
      v-if="interruptState && !subagentGroup"
      name="interrupt"
      :event="interruptState.event"
      :interrupt="interruptState.interrupt"
      :interrupts="interruptState.interrupts"
      :result="interruptState.result"
      :resolve="interruptState.resolve"
      :cancel="interruptState.cancel"
    />

    <slot v-if="showCursor && !subagentGroup" name="cursor">
      <div
        class="cpk:w-[11px] cpk:h-[11px] cpk:rounded-full cpk:bg-foreground cpk:animate-pulse cpk:ml-1"
        data-testid="copilot-loading-cursor"
      />
    </slot>
  </div>
</template>
