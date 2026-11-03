import type { AssistantMessage } from "@ag-ui/core";
import type { CopilotKitCore } from "@copilotkit/core";
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { ComputedRef, InjectionKey, Ref } from "vue";
import {
  getMessageFeedback,
  setMessageFeedback,
  subscribeToMessageFeedback,
} from "../../lib/message-feedback";
import type {
  MessageFeedback,
  MessageFeedbackRating,
} from "../../lib/message-feedback";

/** The chat whose assistant messages collect feedback for Learning. */
export interface MessageFeedbackScope {
  readonly copilotkit: CopilotKitCore;
  readonly agentId: string;
  readonly threadId: string;
}

/**
 * Provided by the message view while Learning is on for this chat. Assistant
 * messages without it show thumbs only when the app passes its own handlers
 * or thumb slots.
 * @internal
 */
export const MessageFeedbackScopeKey: InjectionKey<
  Ref<MessageFeedbackScope | null>
> = Symbol("CopilotMessageFeedbackScope");

// Cores that captured since Learning was configured, for chats that mount
// while capture reconnects or is stopped. A Core leaves when its config goes.
const capturedCores = new WeakSet<CopilotKitCore>();

const rememberCapture = (copilotkit: CopilotKitCore) => {
  if (capturedCores.has(copilotkit)) return;
  capturedCores.add(copilotkit);
  const unsubscribe = copilotkit.ɵsubscribeToLearningConfigured(() => {
    if (copilotkit.ɵlearningConfigured) return;
    capturedCores.delete(copilotkit);
    unsubscribe();
  });
};

/**
 * Whether the thumbs record feedback for Learning. True once a Trajectory of
 * this Core has started and as long as Learning stays configured, also while
 * capture reconnects or is stopped, so the buttons do not flicker. Ratings
 * given meanwhile still show but, like any Trajectory event, are not sent.
 * @internal
 */
export function useLearningFeedbackEnabled(
  copilotkit: Ref<CopilotKitCore>,
): ComputedRef<boolean> {
  const configured = ref(false);
  const capturing = ref(false);

  watch(
    copilotkit,
    (core, _previous, onCleanup) => {
      const read = () => {
        configured.value = core.ɵlearningConfigured;
        capturing.value = core.trajectoryId !== null;
        if (capturing.value) rememberCapture(core);
      };
      read();
      const unsubscribeConfigured = core.ɵsubscribeToLearningConfigured(read);
      const subscription = core.subscribe({ onTrajectoryChanged: read });
      onCleanup(() => {
        unsubscribeConfigured();
        subscription.unsubscribe();
      });
    },
    { immediate: true },
  );

  return computed(
    () =>
      configured.value &&
      (capturing.value || capturedCores.has(copilotkit.value)),
  );
}

/** Current feedback for one assistant message, and how to change it. */
export interface MessageFeedbackControls {
  readonly feedback: MessageFeedback | undefined;
  /** Gives `rating`; a different rating than before starts without a comment. */
  readonly rate: (rating: MessageFeedbackRating) => void;
  /** Removes the rating and its comment. */
  readonly clear: () => void;
  /** Sets the current rating's comment; an empty one removes it. */
  readonly comment: (comment: string) => void;
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
        subscribeToMessageFeedback(current.agentId, current.threadId, () => {
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
    const target = message.value;
    const feedback = getMessageFeedback(
      current.agentId,
      current.threadId,
      target.id,
    );
    const save = (next: MessageFeedback | null) =>
      setMessageFeedback({ ...current, message: target, feedback: next });
    return {
      feedback,
      rate: (rating) => {
        if (feedback?.rating !== rating) save({ rating });
      },
      clear: () => {
        if (feedback) save(null);
      },
      comment: (comment) => {
        if (feedback) save({ rating: feedback.rating, comment });
      },
    };
  });
}

/**
 * How long the pointer may be away from the rating and its comment before the
 * comment closes: enough to cross the gap between them, short enough that
 * passing over a rating does not leave it open.
 */
export const FEEDBACK_COMMENT_CLOSE_DELAY_MS = 150;

/** The comment popover of one rated message: when it shows and what it holds. */
export interface FeedbackComment {
  readonly open: Ref<boolean>;
  /** The comment being edited. */
  readonly draft: Ref<string>;
  /** Grows each time the field should take focus: after a keyboard rating. */
  readonly focusRequest: Ref<number>;
  /** Whether a focus request waits; reading it answers the request. */
  readonly takeFocusRequest: () => boolean;
  /** The comment field, for moving focus into it. */
  readonly input: Ref<HTMLInputElement | null>;
  /** Opens with `comment` in the field. */
  readonly show: (options: { comment: string; focus: boolean }) => void;
  /** The pointer or focus reached the rating or the popover. */
  readonly enter: (via?: "pointer" | "focus") => void;
  /**
   * It left them: close soon, unless the user is editing the comment or, when
   * focus left, the pointer is still on the rating or the popover.
   */
  readonly leave: (via?: "pointer" | "focus") => void;
  /** Tracks whether focus is in the comment form. */
  readonly setEditing: (editing: boolean) => void;
  /** Closes, saving a changed comment unless `save` is false. */
  readonly close: (options?: { save?: boolean }) => void;
  /** Moves focus back to the thumb without opening the comment again. */
  readonly returnFocus: (target: HTMLElement | null) => void;
}

/**
 * Drives the comment popover of a rated message, as React's
 * `useFeedbackComment` does.
 *
 * It opens when a rating is given and whenever the pointer or keyboard focus
 * reaches the chosen thumb, with the saved comment in the field. It closes by
 * itself shortly after the pointer leaves the thumb and the popover, unless
 * focus is in the field: then it stays until focus moves away, Enter, or
 * Escape. Closing saves a changed comment; Escape, a click on a thumb, and
 * removing the rating discard it.
 * @internal
 */
export function useFeedbackComment(
  controls: Ref<MessageFeedbackControls | null>,
): FeedbackComment {
  const open = ref(false);
  const draft = ref("");
  const focusRequest = ref(0);
  const input = shallowRef<HTMLInputElement | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let editing = false;
  let focusWaiting = false;
  // Whether the pointer is on the chosen thumb or the popover. Browsers that
  // do not focus a clicked button move focus to nothing while it stays there.
  let pointerOver = false;
  // Set while focus moves back to the thumb, whose focus would open it again.
  let returning = false;

  const takeFocusRequest = () => {
    const waiting = focusWaiting;
    focusWaiting = false;
    return waiting;
  };

  const cancelClose = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const savedComment = () => controls.value?.feedback?.comment ?? "";

  const close = ({ save = true }: { save?: boolean } = {}) => {
    cancelClose();
    focusWaiting = false;
    pointerOver = false;
    if (!open.value) return;
    const current = controls.value;
    if (save && current?.feedback && draft.value.trim() !== savedComment())
      current.comment(draft.value);
    editing = false;
    open.value = false;
  };

  const show = ({ comment, focus }: { comment: string; focus: boolean }) => {
    cancelClose();
    draft.value = comment;
    if (focus) {
      focusWaiting = true;
      focusRequest.value++;
    }
    open.value = true;
  };

  // A message that unmounts (scrolled out of a virtual list) keeps its edit.
  onBeforeUnmount(() => {
    cancelClose();
    const current = controls.value;
    if (
      open.value &&
      current?.feedback &&
      draft.value.trim() !== savedComment()
    )
      current.comment(draft.value);
  });

  return {
    open,
    draft,
    focusRequest,
    takeFocusRequest,
    input,
    show,
    enter: (via = "focus") => {
      cancelClose();
      if (via === "pointer") pointerOver = true;
      if (returning) return;
      if (!open.value && controls.value?.feedback)
        show({ comment: savedComment(), focus: false });
    },
    leave: (via = "focus") => {
      if (via === "pointer") pointerOver = false;
      else if (pointerOver) return;
      cancelClose();
      timer = setTimeout(() => {
        timer = undefined;
        if (!editing) close();
      }, FEEDBACK_COMMENT_CLOSE_DELAY_MS);
    },
    setEditing: (value) => {
      editing = value;
    },
    close,
    returnFocus: (target) => {
      returning = true;
      try {
        target?.focus();
      } finally {
        returning = false;
      }
    },
  };
}
