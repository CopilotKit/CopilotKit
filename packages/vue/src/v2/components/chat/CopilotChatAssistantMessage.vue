<script setup lang="ts">
import {
  computed,
  inject,
  onBeforeUnmount,
  onUpdated,
  ref,
  shallowRef,
  toRef,
  watch,
} from "vue";
import type { Component } from "vue";
import type { AssistantMessage, Message } from "@ag-ui/core";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";
import {
  IconCheck,
  IconCopy,
  IconRefreshCw,
  IconThumbsDown,
  IconThumbsUp,
  IconVolume2,
} from "../icons";
import StreamingMarkdownDefault from "./StreamingMarkdownDefault.vue";
import {
  useMarkdownRenderer,
  isVueComponentRenderer,
} from "../../providers/markdown-renderer";
import CopilotChatToolCallsView from "./CopilotChatToolCallsView.vue";
import { CopilotChatWorkText } from "./turn-work";
import CopilotChatAssistantToolbarButton from "./CopilotChatAssistantToolbarButton.vue";
import CopilotChatFeedbackCommentPopover from "./CopilotChatFeedbackCommentPopover.vue";
import CopilotChatInspectorButton from "./CopilotChatInspectorButton.vue";
import { useInspectorShortcutsHidden } from "./inspector-shortcuts";
import { InspectorKey } from "../../providers/keys";
import { useFeedbackComment, useMessageFeedback } from "./message-feedback";
import type { MessageFeedbackRating } from "../../lib/message-feedback";
import type {
  CopilotChatAssistantMessageCopyButtonSlotProps,
  CopilotChatAssistantMessageFeedbackCommentSlotProps,
  CopilotChatAssistantMessageInspectorButtonSlotProps,
  CopilotChatAssistantMessageLayoutSlotProps,
  CopilotChatAssistantMessageMessageRendererSlotProps,
  CopilotChatAssistantMessageReadAloudButtonSlotProps,
  CopilotChatAssistantMessageRegenerateButtonSlotProps,
  CopilotChatAssistantMessageThumbsDownButtonSlotProps,
  CopilotChatAssistantMessageThumbsUpButtonSlotProps,
  CopilotChatAssistantMessageToolCallsViewSlotProps,
  CopilotChatAssistantMessageToolbarSlotProps,
} from "./types";
const props = withDefaults(
  defineProps<{
    message: AssistantMessage;
    messages?: Message[];
    isRunning?: boolean;
    toolbarVisible?: boolean;
    onThumbsUp?: (message: AssistantMessage) => void;
    onThumbsDown?: (message: AssistantMessage) => void;
    onReadAloud?: (message: AssistantMessage) => void;
    onRegenerate?: (message: AssistantMessage) => void;
  }>(),
  {
    messages: () => [],
    isRunning: false,
    toolbarVisible: true,
  },
);

defineSlots<{
  layout?: (props: CopilotChatAssistantMessageLayoutSlotProps) => unknown;
  "message-renderer"?: (
    props: CopilotChatAssistantMessageMessageRendererSlotProps,
  ) => unknown;
  toolbar?: (props: CopilotChatAssistantMessageToolbarSlotProps) => unknown;
  "copy-button"?: (
    props: CopilotChatAssistantMessageCopyButtonSlotProps,
  ) => unknown;
  "thumbs-up-button"?: (
    props: CopilotChatAssistantMessageThumbsUpButtonSlotProps,
  ) => unknown;
  "thumbs-down-button"?: (
    props: CopilotChatAssistantMessageThumbsDownButtonSlotProps,
  ) => unknown;
  "read-aloud-button"?: (
    props: CopilotChatAssistantMessageReadAloudButtonSlotProps,
  ) => unknown;
  "regenerate-button"?: (
    props: CopilotChatAssistantMessageRegenerateButtonSlotProps,
  ) => unknown;
  "tool-calls-view"?: (
    props: CopilotChatAssistantMessageToolCallsViewSlotProps,
  ) => unknown;
  "inspector-button"?: (
    props: CopilotChatAssistantMessageInspectorButtonSlotProps,
  ) => unknown;
  "feedback-comment"?: (
    props: CopilotChatAssistantMessageFeedbackCommentSlotProps,
  ) => unknown;
  "toolbar-items"?: () => unknown;
  [key: string]: ((props: any) => unknown) | undefined;
}>();

const emit = defineEmits<{
  "thumbs-up": [message: AssistantMessage];
  "thumbs-down": [message: AssistantMessage];
  "read-aloud": [message: AssistantMessage];
  regenerate: [message: AssistantMessage];
}>();

const config = useCopilotChatConfiguration();
const labels = computed(() => config.value?.labels ?? CopilotChatDefaultLabels);
const copied = ref(false);
let copiedResetTimeout: ReturnType<typeof setTimeout> | null = null;

function normalizeContent(content: unknown): string {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const parts = content as Array<{ type?: unknown; text?: unknown }>;
    return parts
      .map((part) => {
        if (
          part &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "text" &&
          typeof part.text === "string"
        ) {
          return part.text;
        }
        return "";
      })
      .filter((text) => text.length > 0)
      .join("\n");
  }

  return "";
}

const normalizedContent = computed(() =>
  normalizeContent(props.message.content),
);
const hasContent = computed(() => normalizedContent.value.trim().length > 0);

const providerMarkdownRenderer = useMarkdownRenderer();
const providerIsComponent = computed(() =>
  isVueComponentRenderer(providerMarkdownRenderer),
);
const ActiveMarkdownRenderer = computed(() =>
  providerIsComponent.value
    ? (providerMarkdownRenderer as Component)
    : StreamingMarkdownDefault,
);
const activeMarkdownConfig = computed(() =>
  providerIsComponent.value || !providerMarkdownRenderer
    ? {}
    : (providerMarkdownRenderer as Record<string, unknown>),
);

const inspector = inject(InspectorKey, null);
const shortcutsHidden = useInspectorShortcutsHidden();
const showInspectorShortcut = computed(
  () => !!inspector?.isInspectorEnabled.value && !shortcutsHidden.value,
);

// Set while this chat collects ratings for Learning: the thumbs record them.
const feedback = useMessageFeedback(toRef(props, "message"));
const comment = useFeedbackComment(feedback);
const rating = computed(() => feedback.value?.feedback?.rating);
const root = ref<HTMLElement | null>(null);
// The chosen thumb the comment popover points at, and the rating the open
// comment answers.
const commentAnchor = shallowRef<HTMLElement | null>(null);
let commentRating = rating.value;

const hasThumbsUp = computed(
  () => typeof props.onThumbsUp === "function" || !!feedback.value,
);
const hasThumbsDown = computed(
  () => typeof props.onThumbsDown === "function" || !!feedback.value,
);
const hasReadAloud = computed(() => typeof props.onReadAloud === "function");
const hasRegenerate = computed(() => typeof props.onRegenerate === "function");
const isLatestAssistantMessage = computed(
  () => props.messages[props.messages.length - 1]?.id === props.message.id,
);
const shouldShowToolbar = computed(
  () =>
    props.toolbarVisible &&
    (hasContent.value || showInspectorShortcut.value) &&
    !(props.isRunning && isLatestAssistantMessage.value),
);

// A custom thumb that calls its handler without an event gives no element:
// point at the chosen thumb once it renders, before the popover reads it.
function findCommentAnchor() {
  if (
    comment.open.value &&
    !commentAnchor.value?.isConnected &&
    rating.value &&
    root.value
  ) {
    commentAnchor.value =
      root.value.querySelector<HTMLElement>(
        `[data-copilotkit-rating="${rating.value}"]`,
      ) ??
      // A custom thumb that binds only `aria-pressed`.
      root.value.querySelector<HTMLElement>('button[aria-pressed="true"]') ??
      null;
  }
}
onUpdated(findCommentAnchor);
watch(() => comment.open.value, findCommentAnchor, { flush: "post" });

/** Whether focus came from the keyboard; a pointer click also focuses buttons. */
function isFocusVisible(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

// Checks `visibility: hidden` too, which a detached popover uses.
const HIDDEN_TOO = { checkVisibilityCSS: true, visibilityProperty: true };

/**
 * Thumbs are toggles: a new rating is saved and opens its comment, and
 * clicking the chosen thumb again removes the rating. A keyboard click
 * (`detail` 0) moves focus into the comment, as there is no pointer. Custom
 * thumb slots may call the handler without an event.
 *
 * @returns Whether the app's handler should run: true for a new rating and
 * whenever this chat does not record ratings, false when one is removed.
 */
function rate(value: MessageFeedbackRating, event?: MouseEvent): boolean {
  const controls = feedback.value;
  if (!controls) return true;
  if (rating.value === value) {
    comment.close({ save: false });
    controls.clear();
    return false;
  }
  controls.rate(value);
  commentRating = value;
  commentAnchor.value =
    event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  comment.show({ comment: "", focus: event?.detail === 0 });
  return true;
}

/** Attributes that let the chosen thumb open and point at its comment. */
function thumbFeedbackProps(
  value: MessageFeedbackRating,
): Record<string, unknown> {
  if (!feedback.value) return {};
  const thumb = { "data-copilotkit-rating": value };
  if (rating.value !== value) return { ...thumb, "aria-pressed": false };
  const enter = (target: HTMLElement, via: "pointer" | "focus") => {
    if (!comment.open.value) commentRating = value;
    commentAnchor.value = target;
    comment.enter(via);
  };
  return {
    ...thumb,
    "aria-pressed": true,
    "aria-haspopup": "dialog",
    "aria-expanded": comment.open.value,
    onPointerenter: (event: PointerEvent) => {
      if (event.pointerType !== "touch")
        enter(event.currentTarget as HTMLElement, "pointer");
    },
    onPointerleave: (event: PointerEvent) => {
      if (event.pointerType !== "touch") comment.leave("pointer");
    },
    // Keyboard focus opens the comment; Tab moves on into its field.
    onFocus: (event: FocusEvent) => {
      const target = event.currentTarget as HTMLElement;
      if (isFocusVisible(target)) enter(target, "focus");
    },
    onBlur: () => comment.leave(),
    onKeydown: (event: KeyboardEvent) => {
      const input = comment.input.value;
      // Not while the popover hides because its thumb scrolled away.
      if (
        event.key === "Tab" &&
        !event.shiftKey &&
        comment.open.value &&
        input &&
        input.checkVisibility?.(HIDDEN_TOO) !== false
      ) {
        event.preventDefault();
        input.focus();
      }
    },
  };
}

const thumbsUpProps = computed(() => thumbFeedbackProps("up"));
const thumbsDownProps = computed(() => thumbFeedbackProps("down"));

// The popover shows only with the toolbar and a rating. Hiding the toolbar
// keeps the edit; a rating removed elsewhere or Learning turned off ends it.
watch(
  [() => comment.open.value, shouldShowToolbar, rating],
  ([open, showToolbar, currentRating]) => {
    if (!open) return;
    // Changed or removed elsewhere: the draft answered the old rating.
    if (currentRating !== commentRating) comment.close({ save: false });
    else if (!showToolbar) comment.close();
  },
);

function handleInspect() {
  inspector?.openInspector({
    messageId: props.message.id,
    threadId: config.value?.threadId,
    agentId: config.value?.agentId,
  });
}

function resetCopiedStateWithDelay() {
  if (copiedResetTimeout) {
    clearTimeout(copiedResetTimeout);
  }
  copied.value = true;
  copiedResetTimeout = setTimeout(() => {
    copied.value = false;
    copiedResetTimeout = null;
  }, 2000);
}

async function handleCopyMessage() {
  const content = normalizedContent.value;
  if (!content) return;

  if (
    typeof navigator === "undefined" ||
    typeof navigator.clipboard?.writeText !== "function"
  ) {
    return;
  }

  try {
    await navigator.clipboard.writeText(content);
    resetCopiedStateWithDelay();
  } catch (error) {
    console.error("Failed to copy to clipboard:", error);
  }
}

function handleThumbsUp(event?: MouseEvent) {
  // The app hears about a rating given, not about one removed.
  if (rate("up", event)) emit("thumbs-up", props.message);
}

function handleThumbsDown(event?: MouseEvent) {
  if (rate("down", event)) emit("thumbs-down", props.message);
}

function handleReadAloud() {
  emit("read-aloud", props.message);
}

function handleRegenerate() {
  emit("regenerate", props.message);
}

onBeforeUnmount(() => {
  if (copiedResetTimeout) {
    clearTimeout(copiedResetTimeout);
  }
});
</script>

<template>
  <slot
    name="layout"
    :message="message"
    :content="normalizedContent"
    :is-running="isRunning"
    :toolbar-visible="toolbarVisible"
    :should-show-toolbar="shouldShowToolbar"
    :message-renderer="$slots['message-renderer'] ?? (() => null)"
    :toolbar="$slots['toolbar'] ?? (() => null)"
    :copy-button="$slots['copy-button'] ?? (() => null)"
    :thumbs-up-button="$slots['thumbs-up-button'] ?? (() => null)"
    :thumbs-down-button="$slots['thumbs-down-button'] ?? (() => null)"
    :read-aloud-button="$slots['read-aloud-button'] ?? (() => null)"
    :regenerate-button="$slots['regenerate-button'] ?? (() => null)"
    :tool-calls-view="$slots['tool-calls-view'] ?? (() => null)"
    :on-copy="handleCopyMessage"
    :on-thumbs-up="handleThumbsUp"
    :on-thumbs-down="handleThumbsDown"
    :on-read-aloud="handleReadAloud"
    :on-regenerate="handleRegenerate"
  >
    <div
      ref="root"
      data-copilotkit
      data-testid="copilot-assistant-message"
      class="copilotKitMessage copilotKitAssistantMessage"
      :data-message-id="message.id"
      v-bind="$attrs"
    >
      <CopilotChatWorkText :message-id="message.id">
        <div class="cpk-markdown cpk-assistant-message-markdown">
          <slot
            name="message-renderer"
            :message="message"
            :content="normalizedContent"
          >
            <component
              :is="ActiveMarkdownRenderer"
              v-if="hasContent"
              v-bind="activeMarkdownConfig"
              :content="normalizedContent"
              :is-streaming="isRunning && isLatestAssistantMessage"
            />
          </slot>
        </div>
      </CopilotChatWorkText>

      <slot name="tool-calls-view" :message="message" :messages="messages">
        <CopilotChatToolCallsView :message="message" :messages="messages">
          <template
            v-for="(_, slotName) in $slots"
            :key="slotName"
            #[slotName]="slotProps"
          >
            <slot :name="slotName" v-bind="slotProps" />
          </template>
        </CopilotChatToolCallsView>
      </slot>

      <slot
        v-if="shouldShowToolbar"
        name="toolbar"
        :message="message"
        :should-show-toolbar="shouldShowToolbar"
      >
        <div
          data-testid="copilot-assistant-toolbar"
          class="cpk-assistant-message-toolbar"
        >
          <div class="cpk-assistant-message-toolbar-items">
            <slot
              name="copy-button"
              :on-copy="handleCopyMessage"
              :copied="copied"
              :label="labels.assistantMessageToolbarCopyMessageLabel"
            >
              <CopilotChatAssistantToolbarButton
                data-testid="copilot-copy-button"
                :label="labels.assistantMessageToolbarCopyMessageLabel"
                @click="handleCopyMessage"
              >
                <IconCheck
                  v-if="copied"
                  class="cpk-assistant-message-toolbar-icon"
                />
                <IconCopy v-else class="cpk-assistant-message-toolbar-icon" />
              </CopilotChatAssistantToolbarButton>
            </slot>

            <slot
              v-if="hasThumbsUp || $slots['thumbs-up-button']"
              name="thumbs-up-button"
              :on-thumbs-up="handleThumbsUp"
              :label="labels.assistantMessageToolbarThumbsUpLabel"
              :pressed="rating === 'up'"
              :thumb-props="thumbsUpProps"
            >
              <CopilotChatAssistantToolbarButton
                data-testid="copilot-thumbs-up-button"
                :label="labels.assistantMessageToolbarThumbsUpLabel"
                v-bind="thumbsUpProps"
                @click="handleThumbsUp"
              >
                <IconThumbsUp
                  class="cpk-assistant-message-toolbar-icon"
                  :fill="rating === 'up' ? 'currentColor' : 'none'"
                />
              </CopilotChatAssistantToolbarButton>
            </slot>

            <slot
              v-if="hasThumbsDown || $slots['thumbs-down-button']"
              name="thumbs-down-button"
              :on-thumbs-down="handleThumbsDown"
              :label="labels.assistantMessageToolbarThumbsDownLabel"
              :pressed="rating === 'down'"
              :thumb-props="thumbsDownProps"
            >
              <CopilotChatAssistantToolbarButton
                data-testid="copilot-thumbs-down-button"
                :label="labels.assistantMessageToolbarThumbsDownLabel"
                v-bind="thumbsDownProps"
                @click="handleThumbsDown"
              >
                <IconThumbsDown
                  class="cpk-assistant-message-toolbar-icon"
                  :fill="rating === 'down' ? 'currentColor' : 'none'"
                />
              </CopilotChatAssistantToolbarButton>
            </slot>

            <slot
              v-if="hasReadAloud || $slots['read-aloud-button']"
              name="read-aloud-button"
              :on-read-aloud="handleReadAloud"
              :label="labels.assistantMessageToolbarReadAloudLabel"
            >
              <CopilotChatAssistantToolbarButton
                data-testid="copilot-read-aloud-button"
                :label="labels.assistantMessageToolbarReadAloudLabel"
                @click="handleReadAloud"
              >
                <IconVolume2 class="cpk-assistant-message-read-aloud-icon" />
              </CopilotChatAssistantToolbarButton>
            </slot>

            <slot
              v-if="hasRegenerate || $slots['regenerate-button']"
              name="regenerate-button"
              :on-regenerate="handleRegenerate"
              :label="labels.assistantMessageToolbarRegenerateLabel"
            >
              <CopilotChatAssistantToolbarButton
                data-testid="copilot-regenerate-button"
                :label="labels.assistantMessageToolbarRegenerateLabel"
                @click="handleRegenerate"
              >
                <IconRefreshCw class="cpk-assistant-message-toolbar-icon" />
              </CopilotChatAssistantToolbarButton>
            </slot>

            <slot name="toolbar-items" />

            <slot
              v-if="showInspectorShortcut"
              name="inspector-button"
              :on-inspect="handleInspect"
              :label="labels.assistantMessageToolbarInspectorLabel"
            >
              <CopilotChatInspectorButton @click="handleInspect" />
            </slot>
          </div>
        </div>
      </slot>
    </div>
  </slot>

  <!-- Floats in a portal next to the chosen thumb, so it never moves the chat. -->
  <CopilotChatFeedbackCommentPopover
    v-if="feedback?.feedback && shouldShowToolbar"
    :comment="comment"
    :saved-comment="feedback.feedback.comment ?? ''"
    :rating="feedback.feedback.rating"
    :anchor="commentAnchor"
    :message-id="message.id"
  >
    <template v-if="$slots['feedback-comment']" #feedback-comment="slotProps">
      <slot name="feedback-comment" v-bind="slotProps" />
    </template>
  </CopilotChatFeedbackCommentPopover>
</template>
