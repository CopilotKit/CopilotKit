import type { AssistantMessage } from "@ag-ui/core";
import type { CopilotKitCore } from "@copilotkit/core";
import {
  ɵFeedbackCommentController,
  ɵgetMessageFeedback,
  ɵgetMessageFeedbackControls,
  ɵisLearningFeedbackEnabled,
  ɵsubscribeToLearningFeedbackEnabled,
  ɵsubscribeToMessageFeedback,
} from "@copilotkit/core";
import type {
  ɵMessageFeedbackControls,
  ɵMessageFeedbackScope,
} from "@copilotkit/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { RefObject } from "react";

/** The chat whose assistant messages collect feedback for Learning. */
export type MessageFeedbackScope = ɵMessageFeedbackScope;

/** Current feedback for one assistant message, and how to change it. */
export type MessageFeedbackControls = ɵMessageFeedbackControls;

/**
 * Set by the message view while Learning is on for this chat. Assistant
 * messages without it show thumbs only when the app passes its own handlers
 * or thumb slots.
 */
export const MessageFeedbackScopeContext =
  createContext<MessageFeedbackScope | null>(null);

/**
 * Whether the thumbs record feedback for Learning. See core's
 * `ɵisLearningFeedbackEnabled` for the rules.
 */
export function useLearningFeedbackEnabled(copilotkit: CopilotKitCore) {
  const subscribe = useCallback(
    (onChange: () => void) =>
      ɵsubscribeToLearningFeedbackEnabled(copilotkit, onChange),
    [copilotkit],
  );
  return useSyncExternalStore(
    subscribe,
    () => ɵisLearningFeedbackEnabled(copilotkit),
    () => false,
  );
}

const noSubscription = () => () => {};

/** Feedback controls for `message`, or `null` when this chat collects none. */
export function useMessageFeedback(message: AssistantMessage) {
  const scope = useContext(MessageFeedbackScopeContext);
  const subscribe = useCallback(
    (onChange: () => void) =>
      scope
        ? ɵsubscribeToMessageFeedback(scope.agentId, scope.threadId, onChange)
        : noSubscription(),
    [scope],
  );
  const getSnapshot = () =>
    scope
      ? ɵgetMessageFeedback(scope.agentId, scope.threadId, message.id)
      : undefined;
  // Re-renders when this message's rating changes.
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return scope ? ɵgetMessageFeedbackControls(scope, message) : null;
}

/** The comment popover of one rated message: when it shows and what it holds. */
export interface FeedbackComment {
  readonly open: boolean;
  /** The comment being edited. */
  readonly draft: string;
  readonly setDraft: (draft: string) => void;
  /** Grows each time the field should take focus: after a keyboard rating. */
  readonly focusRequest: number;
  /** Whether a focus request waits; reading it answers the request. */
  readonly takeFocusRequest: () => boolean;
  /** The comment field, for moving focus into it. */
  readonly inputRef: RefObject<HTMLInputElement | null>;
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
 */
export function useFeedbackComment(
  controls: MessageFeedbackControls | null,
): FeedbackComment {
  const latestControls = useRef(controls);
  latestControls.current = controls;
  const [controller] = useState(
    () =>
      new ɵFeedbackCommentController({
        getControls: () => latestControls.current,
      }),
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  // A message that unmounts (scrolled out of a virtual list) keeps its edit.
  useEffect(() => controller.dispose, [controller]);

  return {
    ...state,
    setDraft: controller.setDraft,
    takeFocusRequest: controller.takeFocusRequest,
    inputRef,
    show: controller.show,
    enter: controller.enter,
    leave: controller.leave,
    setEditing: controller.setEditing,
    close: controller.close,
    returnFocus: controller.returnFocus,
  };
}
