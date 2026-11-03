import type { AssistantMessage } from "@ag-ui/core";
import type { CopilotKitCore } from "@copilotkit/core";
import {
  ɵFeedbackCommentController,
  ɵgetMessageFeedbackControls,
  ɵisLearningFeedbackEnabled,
  ɵsubscribeToLearningFeedbackEnabled,
  ɵsubscribeToMessageFeedback,
} from "@copilotkit/core";
import type {
  ɵMessageFeedbackControls,
  ɵMessageFeedbackScope,
} from "@copilotkit/core";
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type {
  ComputedRef,
  InjectionKey,
  Ref,
  ShallowRef,
  WritableComputedRef,
} from "vue";

/** The chat whose assistant messages collect feedback for Learning. */
export type MessageFeedbackScope = ɵMessageFeedbackScope;

/** Current feedback for one assistant message, and how to change it. */
export type MessageFeedbackControls = ɵMessageFeedbackControls;

/**
 * Provided by the message view while Learning is on for this chat. Assistant
 * messages without it show thumbs only when the app passes its own handlers
 * or thumb slots.
 * @internal
 */
export const MessageFeedbackScopeKey: InjectionKey<
  Ref<MessageFeedbackScope | null>
> = Symbol("CopilotMessageFeedbackScope");

/**
 * Whether the thumbs record feedback for Learning. See core's
 * `ɵisLearningFeedbackEnabled` for the rules.
 * @internal
 */
export function useLearningFeedbackEnabled(
  copilotkit: Ref<CopilotKitCore>,
): ComputedRef<boolean> {
  const enabled = ref(false);
  watch(
    copilotkit,
    (core, _previous, onCleanup) => {
      const read = () => {
        enabled.value = ɵisLearningFeedbackEnabled(core);
      };
      read();
      onCleanup(ɵsubscribeToLearningFeedbackEnabled(core, read));
    },
    { immediate: true },
  );
  return computed(() => enabled.value);
}

/** Feedback controls for `message`, or `null` when this chat collects none. */
export function useMessageFeedback(
  message: Ref<AssistantMessage>,
): ComputedRef<MessageFeedbackControls | null> {
  const scope = inject(MessageFeedbackScopeKey, ref(null));
  // Bumped by the store whenever a rating in this Thread changes.
  const version = ref(0);

  watch(
    scope,
    (current, _previous, onCleanup) => {
      if (!current) return;
      onCleanup(
        ɵsubscribeToMessageFeedback(current.agentId, current.threadId, () => {
          version.value++;
        }),
      );
    },
    { immediate: true },
  );

  return computed(() => {
    const current = scope.value;
    if (!current) return null;
    void version.value;
    return ɵgetMessageFeedbackControls(current, message.value);
  });
}

/** The comment popover of one rated message: when it shows and what it holds. */
export interface FeedbackComment {
  readonly open: ComputedRef<boolean>;
  /** The comment being edited. */
  readonly draft: WritableComputedRef<string>;
  /** Grows each time the field should take focus: after a keyboard rating. */
  readonly focusRequest: ComputedRef<number>;
  /** Whether a focus request waits; reading it answers the request. */
  readonly takeFocusRequest: () => boolean;
  /** The comment field, for moving focus into it. */
  readonly input: ShallowRef<HTMLInputElement | null>;
  /** Opens with `comment` in the field. */
  readonly show: ɵFeedbackCommentController["show"];
  /** The pointer or focus reached the rating or the popover. */
  readonly enter: ɵFeedbackCommentController["enter"];
  /**
   * It left them: close soon, unless the user is editing the comment or, when
   * focus left, the pointer is still on the rating or the popover.
   */
  readonly leave: ɵFeedbackCommentController["leave"];
  /** Tracks whether focus is in the comment form. */
  readonly setEditing: (editing: boolean) => void;
  /** Closes, saving a changed comment unless `save` is false. */
  readonly close: ɵFeedbackCommentController["close"];
  /** Moves focus back to the thumb without opening the comment again. */
  readonly returnFocus: (target: HTMLElement | null) => void;
}

/**
 * Drives the comment popover of a rated message with core's
 * `ɵFeedbackCommentController`, which holds the open and close rules.
 * @internal
 */
export function useFeedbackComment(
  controls: Ref<MessageFeedbackControls | null>,
): FeedbackComment {
  const controller = new ɵFeedbackCommentController({
    getControls: () => controls.value,
  });
  const state = shallowRef(controller.getSnapshot());
  const unsubscribe = controller.subscribe(() => {
    state.value = controller.getSnapshot();
  });
  // A message that unmounts (scrolled out of a virtual list) keeps its edit.
  onBeforeUnmount(() => {
    controller.dispose();
    unsubscribe();
  });

  return {
    open: computed(() => state.value.open),
    draft: computed({
      get: () => state.value.draft,
      set: controller.setDraft,
    }),
    focusRequest: computed(() => state.value.focusRequest),
    takeFocusRequest: controller.takeFocusRequest,
    input: shallowRef<HTMLInputElement | null>(null),
    show: controller.show,
    enter: controller.enter,
    leave: controller.leave,
    setEditing: controller.setEditing,
    close: controller.close,
    returnFocus: controller.returnFocus,
  };
}
