<script setup lang="ts">
/**
 * The comment popover of a rated message, pointing at the chosen thumb, as in
 * React's `FeedbackCommentPopover`.
 *
 * The popover lives in a portal, so it keeps keyboard order by hand: Shift+Tab
 * from its start returns to the thumb, Tab from its end moves on to the
 * control after the thumb, and Enter or Escape inside it returns to the thumb.
 *
 * @internal
 */
import { computed, nextTick, ref, watch } from "vue";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";
import {
  ɵMESSAGE_FEEDBACK_MAX_COMMENT_LENGTH as MESSAGE_FEEDBACK_MAX_COMMENT_LENGTH,
  ɵisOwnFeedbackThumb,
} from "@copilotkit/core";
import type { ɵMessageFeedbackRating as MessageFeedbackRating } from "@copilotkit/core";
import CopilotPopover from "../ui/CopilotPopover.vue";
import { IconArrowUp } from "../icons";
import type { FeedbackComment } from "./message-feedback";
import type { CopilotChatAssistantMessageFeedbackCommentSlotProps } from "./types";

const props = defineProps<{
  comment: FeedbackComment;
  savedComment: string;
  rating: MessageFeedbackRating;
  anchor: HTMLElement | null;
  messageId: string;
}>();

defineSlots<{
  "feedback-comment"?: (
    props: CopilotChatAssistantMessageFeedbackCommentSlotProps,
  ) => unknown;
}>();

const config = useCopilotChatConfiguration();
const labels = computed(() => config.value?.labels ?? CopilotChatDefaultLabels);
const popover = ref<{ content: HTMLElement | null } | null>(null);
const contentElement = () => popover.value?.content ?? null;

// A keyboard rating moves focus into the field, as the popover opens or, when
// it was open already, as the field for the new rating renders.
watch(
  () => [props.comment.focusRequest.value, props.comment.open.value],
  async () => {
    await nextTick();
    props.comment.focusField();
  },
  // Immediate: the popover mounts as it opens, after the request was made.
  { flush: "post", immediate: true },
);

const setInput = (element: unknown) => {
  props.comment.input.value =
    element instanceof HTMLInputElement ? element : null;
};

const changed = computed(
  () => props.comment.draft.value.trim() !== props.savedComment,
);

function onEscape(event: KeyboardEvent) {
  // Escape in the comment closes only the comment, not a chat popup around
  // it; with focus elsewhere it also reaches that control.
  if (props.comment.popoverEscape(contentElement())) event.stopPropagation();
  event.preventDefault();
}

function onInteractOutside(event: Event) {
  // A click on a thumb removes or switches the rating, so closing must not
  // first save the draft as the answer to the rating it replaces.
  if (ɵisOwnFeedbackThumb(event.target, props.messageId))
    event.preventDefault();
}

function onKeyDown(event: KeyboardEvent) {
  props.comment.popoverKeyDown(event, contentElement());
}

function onSubmit() {
  props.comment.submit();
}

function onEditingChange(editing: boolean) {
  props.comment.setEditing(editing);
}

function onLeave(next: Element | null) {
  props.comment.popoverFocusLeave(next, contentElement(), props.messageId);
}

function onFormFocusOut(event: FocusEvent) {
  const form = event.currentTarget as HTMLElement;
  const next =
    event.relatedTarget instanceof Element ? event.relatedTarget : null;
  if (form.contains(next)) return;
  // Switching to another window is not leaving the comment.
  if (typeof document !== "undefined" && !document.hasFocus()) return;
  onEditingChange(false);
  onLeave(next);
}

const slotProps = computed<CopilotChatAssistantMessageFeedbackCommentSlotProps>(
  () => ({
    value: props.comment.draft.value,
    savedComment: props.savedComment,
    inputRef: setInput,
    onChange: (value: string) => {
      props.comment.draft.value = value;
    },
    onSubmit,
    onEditingChange,
    onLeave,
  }),
);
</script>

<template>
  <CopilotPopover
    ref="popover"
    :open="comment.open.value"
    :anchor="anchor"
    side="bottom"
    :collision-padding="8"
    hide-when-detached
    :aria-label="labels.assistantMessageFeedbackCommentPlaceholder"
    data-copilotkit-ignore
    class="cpk-assistant-message-feedback-popover"
    @dismiss="comment.close()"
    @escape-key-down="onEscape"
    @interact-outside="onInteractOutside"
    @keydown="onKeyDown"
    @pointerenter="comment.enter('pointer')"
    @pointerleave="comment.leave('pointer')"
  >
    <!-- Keyed on the rating, so a new rating starts with a fresh field. -->
    <template v-for="key in [rating]" :key="key">
      <slot name="feedback-comment" v-bind="slotProps">
        <form
          data-testid="copilot-feedback-comment"
          class="cpk-assistant-message-feedback-comment"
          @submit.prevent="onSubmit"
          @focusin="onEditingChange(true)"
          @focusout="onFormFocusOut"
        >
          <input
            :ref="setInput"
            :value="comment.draft.value"
            :maxlength="MESSAGE_FEEDBACK_MAX_COMMENT_LENGTH"
            :placeholder="labels.assistantMessageFeedbackCommentPlaceholder"
            :aria-label="labels.assistantMessageFeedbackCommentPlaceholder"
            class="cpk-assistant-message-feedback-comment-input"
            @input="
              comment.draft.value = ($event.target as HTMLInputElement).value
            "
          />
          <button
            v-if="changed"
            type="submit"
            class="cpk-button cpk-button-assistant-message-toolbar cpk-button-size-default"
            :aria-label="labels.assistantMessageFeedbackCommentSubmitLabel"
            :title="labels.assistantMessageFeedbackCommentSubmitLabel"
          >
            <IconArrowUp
              class="cpk-assistant-message-feedback-comment-submit-icon"
            />
          </button>
        </form>
      </slot>
    </template>
  </CopilotPopover>
</template>
