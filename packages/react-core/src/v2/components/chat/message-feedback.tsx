import type { AssistantMessage } from "@ag-ui/core";
import type { CopilotKitCore } from "@copilotkit/core";
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
 * Set by the message view while Learning is on for this chat. Assistant
 * messages without it show thumbs only when the app passes its own handlers
 * or thumb slots.
 */
export const MessageFeedbackScopeContext =
  createContext<MessageFeedbackScope | null>(null);

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
 * given meanwhile still show but, like any Trajectory event, are not
 * sent. A capture that never starts (for example without a license) leaves it
 * false.
 */
export function useLearningFeedbackEnabled(copilotkit: CopilotKitCore) {
  const subscribeConfigured = useCallback(
    (onChange: () => void) =>
      copilotkit.ɵsubscribeToLearningConfigured(onChange),
    [copilotkit],
  );
  const configured = useSyncExternalStore(
    subscribeConfigured,
    () => copilotkit.ɵlearningConfigured,
    () => false,
  );
  const subscribeTrajectory = useCallback(
    (onChange: () => void) =>
      copilotkit.subscribe({ onTrajectoryChanged: onChange }).unsubscribe,
    [copilotkit],
  );
  const capturing = useSyncExternalStore(
    subscribeTrajectory,
    () => copilotkit.trajectoryId !== null,
    () => false,
  );
  useEffect(() => {
    if (capturing) rememberCapture(copilotkit);
  }, [capturing, copilotkit]);
  return configured && (capturing || capturedCores.has(copilotkit));
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

const noSubscription = () => () => {};

/** Feedback controls for `message`, or `null` when this chat collects none. */
export function useMessageFeedback(
  message: AssistantMessage,
): MessageFeedbackControls | null {
  const scope = useContext(MessageFeedbackScopeContext);
  const subscribe = useCallback(
    (onChange: () => void) =>
      scope
        ? subscribeToMessageFeedback(scope.agentId, scope.threadId, onChange)
        : noSubscription(),
    [scope],
  );
  const getSnapshot = () =>
    scope
      ? getMessageFeedback(scope.agentId, scope.threadId, message.id)
      : undefined;
  const feedback = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!scope) return null;

  const save = (next: MessageFeedback | null) =>
    setMessageFeedback({ ...scope, message, feedback: next });
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
}

/**
 * How long the pointer may be away from the rating and its comment before the
 * comment closes: enough to cross the gap between them, short enough that
 * passing over a rating does not leave it open.
 */
export const FEEDBACK_COMMENT_CLOSE_DELAY_MS = 150;

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
 * Drives the comment popover of a rated message.
 *
 * It opens when a rating is given and whenever the pointer or keyboard focus
 * reaches the chosen thumb, with the saved comment in the field. It closes by
 * itself shortly after the pointer leaves the thumb and the popover, unless
 * focus is in the field: then it stays until focus moves away, Enter, or
 * Escape. Closing saves a changed comment; Escape, a click on a thumb, and
 * removing the rating discard it.
 */
export function useFeedbackComment(
  controls: MessageFeedbackControls | null,
): FeedbackComment {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [focusRequest, setFocusRequest] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editing = useRef(false);
  const focusWaiting = useRef(false);
  // Whether the pointer is on the chosen thumb or the popover. Browsers that
  // do not focus a clicked button move focus to nothing while it stays there.
  const pointerOver = useRef(false);
  // Set while focus moves back to the thumb, whose focus would open it again.
  const returning = useRef(false);
  // Handlers and timers read the newest state from here.
  const latest = useRef({ controls, draft, open });
  latest.current = { ...latest.current, controls, draft, open };

  const takeFocusRequest = useCallback(() => {
    const waiting = focusWaiting.current;
    focusWaiting.current = false;
    return waiting;
  }, []);

  // Stable, as they only read refs, so effects that depend on `close` run
  // only when their own inputs change.
  const cancelClose = useCallback(() => {
    if (timer.current === undefined) return;
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  useEffect(() => cancelClose, [cancelClose]);

  const savedComment = useCallback(
    () => latest.current.controls?.feedback?.comment ?? "",
    [],
  );

  // A message that unmounts (scrolled out of a virtual list) keeps its edit.
  useEffect(
    () => () => {
      const { open: wasOpen, controls: current, draft: text } = latest.current;
      if (wasOpen && current?.feedback && text.trim() !== savedComment())
        current.comment(text);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the latest state at unmount
    [],
  );

  const close = useCallback(
    ({ save = true }: { save?: boolean } = {}) => {
      cancelClose();
      focusWaiting.current = false;
      pointerOver.current = false;
      if (!latest.current.open) return;
      const current = latest.current.controls;
      if (
        save &&
        current?.feedback &&
        latest.current.draft.trim() !== savedComment()
      )
        current.comment(latest.current.draft);
      editing.current = false;
      latest.current = { ...latest.current, open: false };
      setOpen(false);
    },
    [cancelClose, savedComment],
  );

  const show = ({ comment, focus }: { comment: string; focus: boolean }) => {
    cancelClose();
    latest.current = { ...latest.current, open: true, draft: comment };
    setDraft(comment);
    if (focus) {
      focusWaiting.current = true;
      setFocusRequest((request) => request + 1);
    }
    setOpen(true);
  };

  return {
    open,
    draft,
    setDraft,
    focusRequest,
    takeFocusRequest,
    inputRef,
    show,
    enter: (via = "focus") => {
      cancelClose();
      if (via === "pointer") pointerOver.current = true;
      if (returning.current) return;
      if (!latest.current.open && latest.current.controls?.feedback)
        show({ comment: savedComment(), focus: false });
    },
    leave: (via = "focus") => {
      if (via === "pointer") pointerOver.current = false;
      else if (pointerOver.current) return;
      cancelClose();
      timer.current = setTimeout(() => {
        timer.current = undefined;
        if (!editing.current) close();
      }, FEEDBACK_COMMENT_CLOSE_DELAY_MS);
    },
    setEditing: (value) => {
      editing.current = value;
    },
    close,
    returnFocus: (target) => {
      returning.current = true;
      try {
        target?.focus();
      } finally {
        returning.current = false;
      }
    },
  };
}
