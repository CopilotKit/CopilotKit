import type { AssistantMessage } from "@ag-ui/core";
import type { CopilotKitCore } from "../core/core";
import { ɵisFocusVisible, ɵnextTabStop, ɵTAB_STOP_SELECTOR } from "./dom";

/** Trajectory event name for a rating of one assistant message. */
export const ɵMESSAGE_FEEDBACK_EVENT_NAME = "message.feedback";

/** Longest comment kept, in characters; the rest is cut so the event stays small. */
export const ɵMESSAGE_FEEDBACK_MAX_COMMENT_LENGTH = 1000;

/** Longest excerpt of the rated response sent with the rating, in characters. */
const RESPONSE_EXCERPT_LENGTH = 500;

/**
 * How long the pointer may be away from the rating and its comment before the
 * comment closes: enough to cross the gap between them, short enough that
 * passing over a rating does not leave it open.
 */
export const ɵFEEDBACK_COMMENT_CLOSE_DELAY_MS = 150;

export type ɵMessageFeedbackRating = "up" | "down";

/** The rating this page gave one assistant message. */
export interface ɵMessageFeedback {
  readonly rating: ɵMessageFeedbackRating;
  readonly comment?: string;
}

/** The chat whose assistant messages collect feedback for Learning. */
export interface ɵMessageFeedbackScope {
  readonly copilotkit: CopilotKitCore;
  readonly agentId: string;
  readonly threadId: string;
}

// Ratings given on this page, by message. Kept outside the frameworks, so a
// rated message that scrolls out of a virtual list still shows its rating
// when it comes back. Intelligence holds the ratings across page loads.
const ratings = new Map<string, ɵMessageFeedback>();
const listeners = new Map<string, Set<() => void>>();

const threadKey = (agentId: string, threadId: string) =>
  JSON.stringify([agentId, threadId]);

const messageKey = (agentId: string, threadId: string, messageId: string) =>
  JSON.stringify([agentId, threadId, messageId]);

/** Cuts `text` to `max` characters without splitting a surrogate pair. */
const clip = (text: string, max: number) => {
  const characters = Array.from(text);
  return characters.length > max ? characters.slice(0, max).join("") : text;
};

/** The comment as kept and sent: trimmed and capped, or none. */
const normalizeComment = (comment: string | undefined) => {
  if (comment === undefined) return undefined;
  const text = clip(comment.trim(), ɵMESSAGE_FEEDBACK_MAX_COMMENT_LENGTH);
  return text === "" ? undefined : text;
};

/** The rating this page gave one message, if any. */
export function ɵgetMessageFeedback(
  agentId: string,
  threadId: string,
  messageId: string,
) {
  return ratings.get(messageKey(agentId, threadId, messageId));
}

/** Calls `listener` whenever a rating in this Thread changes. */
export function ɵsubscribeToMessageFeedback(
  agentId: string,
  threadId: string,
  listener: () => void,
) {
  const key = threadKey(agentId, threadId);
  let set = listeners.get(key);
  if (set === undefined) {
    set = new Set();
    listeners.set(key, set);
  }
  const subscribed = set;
  subscribed.add(listener);
  return () => {
    subscribed.delete(listener);
    if (subscribed.size === 0) listeners.delete(key);
  };
}

/**
 * Sets (or, with `null`, clears) this page's rating of one message and sends
 * it to the active Trajectory. Every change is a new event; the newest event
 * for a `feedbackId` is the current one. Like any Trajectory event, a change
 * made while no Trajectory captures, for example during a reconnect, is not
 * sent; the page still shows it.
 */
export function ɵsetMessageFeedback(
  params: ɵMessageFeedbackScope & {
    message: AssistantMessage;
    feedback: ɵMessageFeedback | null;
  },
) {
  const { copilotkit, agentId, threadId, message } = params;
  const comment = normalizeComment(params.feedback?.comment);
  const feedback: ɵMessageFeedback | null = params.feedback && {
    rating: params.feedback.rating,
    ...(comment ? { comment } : {}),
  };

  const key = messageKey(agentId, threadId, message.id);
  if (feedback) ratings.set(key, feedback);
  else ratings.delete(key);
  const threadListeners = listeners.get(threadKey(agentId, threadId)) ?? [];
  for (const listener of threadListeners) listener();

  const runId = copilotkit.getRunIdForMessage(agentId, threadId, message.id);
  copilotkit.emitTrajectoryEvent(ɵMESSAGE_FEEDBACK_EVENT_NAME, {
    feedbackId: `${threadId}:${message.id}`,
    threadId,
    messageId: message.id,
    agentId,
    ...(runId ? { runId } : {}),
    rating: feedback?.rating ?? null,
    ...(feedback?.comment ? { comment: feedback.comment } : {}),
    // A custom sink set to omit agent text gets no excerpt of the reply.
    ...(copilotkit.ɵlearningCapturesAgentText
      ? { response: clip(message.content ?? "", RESPONSE_EXCERPT_LENGTH) }
      : {}),
  });
}

/** @internal Forgets every rating, so each test starts empty. */
export function ɵresetMessageFeedbackCache() {
  ratings.clear();
}

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
 * given meanwhile still show but, like any Trajectory event, are not sent. A
 * capture that never starts (for example without a license) leaves it false.
 *
 * Re-read it when {@link ɵsubscribeToLearningFeedbackEnabled} notifies.
 */
export function ɵisLearningFeedbackEnabled(copilotkit: CopilotKitCore) {
  const capturing = copilotkit.trajectoryId !== null;
  if (capturing) rememberCapture(copilotkit);
  return (
    copilotkit.ɵlearningConfigured &&
    (capturing || capturedCores.has(copilotkit))
  );
}

/**
 * Calls `listener` when {@link ɵisLearningFeedbackEnabled} may have changed:
 * when Learning is configured or removed, and when the Trajectory changes.
 * Returns the unsubscribe function.
 */
export function ɵsubscribeToLearningFeedbackEnabled(
  copilotkit: CopilotKitCore,
  listener: () => void,
) {
  const unsubscribeConfigured =
    copilotkit.ɵsubscribeToLearningConfigured(listener);
  const subscription = copilotkit.subscribe({
    onTrajectoryChanged: listener,
  });
  return () => {
    unsubscribeConfigured();
    subscription.unsubscribe();
  };
}

/** Current feedback for one assistant message, and how to change it. */
export interface ɵMessageFeedbackControls {
  readonly feedback: ɵMessageFeedback | undefined;
  /** Gives `rating`; a different rating than before starts without a comment. */
  readonly rate: (rating: ɵMessageFeedbackRating) => void;
  /** Removes the rating and its comment. */
  readonly clear: () => void;
  /** Sets the current rating's comment; an empty one removes it. */
  readonly comment: (comment: string) => void;
}

/**
 * The feedback this page gave `message` in `scope`, and how to change it.
 * Read it again when {@link ɵsubscribeToMessageFeedback} notifies for the
 * scope's Thread.
 */
export function ɵgetMessageFeedbackControls(
  scope: ɵMessageFeedbackScope,
  message: AssistantMessage,
): ɵMessageFeedbackControls {
  const feedback = ɵgetMessageFeedback(
    scope.agentId,
    scope.threadId,
    message.id,
  );
  const save = (next: ɵMessageFeedback | null) =>
    ɵsetMessageFeedback({ ...scope, message, feedback: next });
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

/** What the comment popover of one rated message shows. */
export interface ɵFeedbackCommentState {
  readonly open: boolean;
  /** The comment being edited. */
  readonly draft: string;
  /** Grows each time the field should take focus: after a keyboard rating. */
  readonly focusRequest: number;
  /** The chosen thumb the popover points at, or `null` before it is known. */
  readonly anchor: HTMLElement | null;
}

/**
 * The attributes a thumb button carries while this chat records ratings.
 * The chosen thumb also says that it opens the comment popover.
 */
export type ɵFeedbackThumbAttributes =
  | { "data-copilotkit-rating": ɵMessageFeedbackRating; "aria-pressed": false }
  | {
      "data-copilotkit-rating": ɵMessageFeedbackRating;
      "aria-pressed": true;
      "aria-haspopup": "dialog";
      "aria-expanded": boolean;
    };

/** Event handlers of the chosen thumb. Bind each to the event it names. */
export interface ɵFeedbackThumbHandlers {
  pointerEnter: (event: {
    currentTarget: EventTarget | null;
    pointerType: string;
  }) => void;
  pointerLeave: (event: { pointerType: string }) => void;
  focus: (event: { currentTarget: EventTarget | null }) => void;
  blur: () => void;
  keyDown: (event: ɵFeedbackKeyEvent) => void;
}

/** The keyboard fields the comment popover reads. */
export interface ɵFeedbackKeyEvent {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
}

/** What {@link ɵFeedbackCommentController.thumb} gives one thumb button. */
export interface ɵFeedbackThumb {
  attributes: ɵFeedbackThumbAttributes;
  /** Handlers for the chosen thumb; `null` for the other one. */
  handlers: ɵFeedbackThumbHandlers | null;
}

/** Selects a thumb of a rated message by its rating. */
const thumbSelector = (rating: ɵMessageFeedbackRating) =>
  `[data-copilotkit-rating="${rating}"]`;

// Also checks `visibility: hidden`, which a popover detached from its
// scrolled-away thumb uses.
const HIDDEN_TOO = { checkVisibilityCSS: true, visibilityProperty: true };

/**
 * Whether `target` is a thumb of message `messageId`. A click on one decides
 * itself what happens to the comment, so the popover ignores it.
 */
export function ɵisOwnFeedbackThumb(
  target: EventTarget | null,
  messageId: string,
) {
  const thumb =
    target instanceof Element
      ? target.closest("[data-copilotkit-rating]")
      : null;
  return (
    thumb?.closest("[data-message-id]")?.getAttribute("data-message-id") ===
    messageId
  );
}

/** How a pointer or keyboard focus reached or left the rating. */
export type ɵFeedbackCommentVia = "pointer" | "focus";

export interface ɵFeedbackCommentControllerOptions {
  /** The newest feedback controls of the message, or `null` without any. */
  getControls: () => ɵMessageFeedbackControls | null;
  /** The comment field, while it renders. */
  getInput?: () => HTMLElement | null;
  /** Defaults to {@link ɵFEEDBACK_COMMENT_CLOSE_DELAY_MS}. */
  closeDelayMs?: number;
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
 *
 * The thumbs are toggles (see `rate()`), and `thumb()` gives each thumb its
 * attributes and handlers. The popover lives in a portal, so it keeps the
 * keyboard order by hand (see `popoverKeyDown()` and `popoverEscape()`):
 * Shift+Tab from its start returns to the thumb, Tab from its end moves on
 * to the control after the thumb, and Enter or Escape returns to the thumb.
 *
 * Frameworks render from `getSnapshot()` and re-render when `subscribe()`
 * notifies. Call `dispose()` on unmount: it keeps an unsaved edit, for a
 * message that scrolls out of a virtual list. The controller stays usable
 * after `dispose()`, so a remount (React Strict Mode) can keep it.
 *
 * @example
 * ```ts
 * const comment = new ɵFeedbackCommentController({ getControls: () => controls });
 * comment.subscribe(() => render(comment.getSnapshot()));
 * comment.show({ comment: "", focus: false });
 * // On unmount:
 * comment.dispose();
 * ```
 */
export class ɵFeedbackCommentController {
  readonly #getControls: () => ɵMessageFeedbackControls | null;
  readonly #getInput: () => HTMLElement | null;
  readonly #closeDelayMs: number;
  readonly #listeners = new Set<() => void>();
  #state: ɵFeedbackCommentState = {
    open: false,
    draft: "",
    focusRequest: 0,
    anchor: null,
  };
  // The rating the open comment answers.
  #commentRating: ɵMessageFeedbackRating | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #editing = false;
  #focusWaiting = false;
  // Whether the pointer is on the chosen thumb or the popover. Browsers that
  // do not focus a clicked button move focus to nothing while it stays there.
  #pointerOver = false;
  // Set while focus moves back to the thumb, whose focus would open it again.
  #returning = false;

  constructor(options: ɵFeedbackCommentControllerOptions) {
    this.#getControls = options.getControls;
    this.#getInput = options.getInput ?? (() => null);
    this.#commentRating = options.getControls()?.feedback?.rating;
    this.#closeDelayMs =
      options.closeDelayMs ?? ɵFEEDBACK_COMMENT_CLOSE_DELAY_MS;
  }

  /** The current state. The same object until something changes. */
  getSnapshot = () => this.#state;

  /** Calls `listener` when the state changes. Returns the unsubscribe function. */
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Sets the comment being edited. */
  setDraft = (draft: string) => {
    this.#update({ draft });
  };

  /** Whether a focus request waits; reading it answers the request. */
  takeFocusRequest = () => {
    const waiting = this.#focusWaiting;
    this.#focusWaiting = false;
    return waiting;
  };

  /** Opens with `comment` in the field. */
  show = ({ comment, focus }: { comment: string; focus: boolean }) => {
    this.#cancelClose();
    if (focus) this.#focusWaiting = true;
    this.#update({
      open: true,
      draft: comment,
      focusRequest: this.#state.focusRequest + (focus ? 1 : 0),
    });
  };

  /** The pointer or focus reached the rating or the popover. */
  enter = (via: ɵFeedbackCommentVia = "focus") => {
    this.#cancelClose();
    if (via === "pointer") this.#pointerOver = true;
    if (this.#returning) return;
    if (!this.#state.open && this.#getControls()?.feedback)
      this.show({ comment: this.#savedComment(), focus: false });
  };

  /**
   * It left them: close soon, unless the user is editing the comment or, when
   * focus left, the pointer is still on the rating or the popover.
   */
  leave = (via: ɵFeedbackCommentVia = "focus") => {
    if (via === "pointer") this.#pointerOver = false;
    else if (this.#pointerOver) return;
    this.#cancelClose();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (!this.#editing) this.close();
    }, this.#closeDelayMs);
  };

  /** Tracks whether focus is in the comment form. */
  setEditing = (editing: boolean) => {
    this.#editing = editing;
  };

  /** Closes, saving a changed comment unless `save` is false. */
  close = ({ save = true }: { save?: boolean } = {}) => {
    this.#cancelClose();
    this.#focusWaiting = false;
    this.#pointerOver = false;
    if (!this.#state.open) return;
    if (save) this.#saveDraft();
    this.#editing = false;
    this.#update({ open: false });
  };

  /** Moves focus back to the thumb without opening the comment again. */
  returnFocus = (target: Pick<HTMLElement, "focus"> | null) => {
    this.#returning = true;
    try {
      target?.focus();
    } finally {
      this.#returning = false;
    }
  };

  /**
   * A click on thumb `value`. Thumbs are toggles: a new rating is saved and
   * opens its comment, and clicking the chosen thumb again removes the
   * rating. A keyboard click moves focus into the comment, as there is no
   * pointer.
   *
   * @param options.target - The clicked thumb, if the click gave one.
   * @param options.keyboard - The click came from the keyboard (`detail` 0).
   * @returns Whether the app's handler should run: true for a new rating and
   *   whenever this chat does not record ratings, false when one is removed.
   */
  rate = (
    value: ɵMessageFeedbackRating,
    options: { target?: HTMLElement | null; keyboard?: boolean } = {},
  ) => {
    const controls = this.#getControls();
    if (!controls) return true;
    if (controls.feedback?.rating === value) {
      this.close({ save: false });
      controls.clear();
      return false;
    }
    controls.rate(value);
    this.#commentRating = value;
    this.#update({ anchor: options.target ?? null });
    this.show({ comment: "", focus: options.keyboard === true });
    return true;
  };

  /**
   * The attributes and handlers of thumb `value`, or `null` while this chat
   * records no ratings. The chosen thumb opens its comment when the pointer
   * or keyboard focus reaches it, and Tab from it moves into the comment.
   */
  thumb = (value: ɵMessageFeedbackRating): ɵFeedbackThumb | null => {
    const controls = this.#getControls();
    if (!controls) return null;
    if (controls.feedback?.rating !== value) {
      return {
        attributes: { "data-copilotkit-rating": value, "aria-pressed": false },
        handlers: null,
      };
    }
    const enter = (target: EventTarget | null, via: ɵFeedbackCommentVia) => {
      if (!this.#state.open) this.#commentRating = value;
      if (target instanceof HTMLElement) this.#update({ anchor: target });
      this.enter(via);
    };
    return {
      attributes: {
        "data-copilotkit-rating": value,
        "aria-pressed": true,
        "aria-haspopup": "dialog",
        "aria-expanded": this.#state.open,
      },
      handlers: {
        pointerEnter: (event) => {
          if (event.pointerType !== "touch")
            enter(event.currentTarget, "pointer");
        },
        pointerLeave: (event) => {
          if (event.pointerType !== "touch") this.leave("pointer");
        },
        // Keyboard focus opens the comment; Tab moves on into its field.
        focus: (event) => {
          const target = event.currentTarget;
          if (target instanceof Element && ɵisFocusVisible(target))
            enter(target, "focus");
        },
        blur: () => this.leave(),
        keyDown: (event) => {
          const input = this.#getInput();
          // Not while the popover hides because its thumb scrolled away.
          const visible = input?.checkVisibility?.(HIDDEN_TOO) !== false;
          if (
            event.key === "Tab" &&
            !event.shiftKey &&
            this.#state.open &&
            input &&
            visible
          ) {
            event.preventDefault();
            input.focus();
          }
        },
      },
    };
  };

  /**
   * Points the popover at the chosen thumb inside `root` when no thumb was
   * given: a custom thumb can call its click handler without an event. Call
   * it after each render.
   */
  findAnchor = (root: ParentNode | null) => {
    const rating = this.#getControls()?.feedback?.rating;
    if (!this.#state.open || this.#state.anchor?.isConnected || !rating) return;
    const anchor =
      root?.querySelector<HTMLElement>(thumbSelector(rating)) ??
      // A custom thumb that passes on only `aria-pressed`.
      root?.querySelector<HTMLElement>('button[aria-pressed="true"]') ??
      null;
    this.#update({ anchor });
  };

  /**
   * Closes a comment that no longer fits: discards it when the rating was
   * changed or removed elsewhere, and saves it when the toolbar hides. Call
   * it when the rating or `showsToolbar` changes.
   */
  sync = ({ showsToolbar }: { showsToolbar: boolean }) => {
    if (!this.#state.open) return;
    const rating = this.#getControls()?.feedback?.rating;
    if (rating !== this.#commentRating) this.close({ save: false });
    else if (!showsToolbar) this.close();
  };

  /** Moves focus into the comment field when a keyboard rating asked for it. */
  focusField = () => {
    const input = this.#getInput();
    if (input && this.takeFocusRequest()) input.focus();
  };

  /** Saves the comment, closes, and moves focus back to the thumb. */
  submit = () => {
    this.close();
    this.returnFocus(this.#state.anchor);
  };

  /**
   * Escape in the popover: closes without saving, and moves focus back to
   * the thumb when it was in the popover.
   *
   * @param content - The popover element.
   * @returns Whether focus was in the popover. Then stop the event, so it
   *   does not also close a chat popup around the message.
   */
  popoverEscape = (content: Element | null) => {
    const focusInside = content?.contains(content.ownerDocument.activeElement);
    this.close({ save: false });
    if (focusInside) this.returnFocus(this.#state.anchor);
    return focusInside === true;
  };

  /**
   * A key press in the popover: Tab past its last control or Shift+Tab past
   * its first one leaves it, as if it sat right after the thumb.
   *
   * @param content - The popover element.
   */
  popoverKeyDown = (event: ɵFeedbackKeyEvent, content: Element | null) => {
    if (event.key !== "Tab" || !content) return;
    const anchor = this.#state.anchor;
    const stops = Array.from(content.querySelectorAll(ɵTAB_STOP_SELECTOR));
    const active = content.ownerDocument.activeElement;
    const leaving = event.shiftKey
      ? active === stops[0]
      : active === stops[stops.length - 1];
    if (!leaving || !anchor?.isConnected) return;
    event.preventDefault();
    const target = event.shiftKey
      ? anchor
      : (ɵnextTabStop(anchor, content) ?? anchor);
    this.close();
    if (target === anchor) this.returnFocus(target);
    else target.focus();
  };

  /**
   * Focus left the comment form for `next`. Moving within the popover or to
   * a thumb of the message, where the pointer still is, keeps it open.
   *
   * @param content - The popover element.
   */
  popoverFocusLeave = (
    next: Element | null,
    content: Element | null,
    messageId: string,
  ) => {
    if (
      next &&
      (content?.contains(next) || ɵisOwnFeedbackThumb(next, messageId))
    )
      return;
    this.leave();
  };

  /** Stops the close timer and saves a changed comment that is still open. */
  dispose = () => {
    this.#cancelClose();
    if (this.#state.open) this.#saveDraft();
  };

  #savedComment() {
    return this.#getControls()?.feedback?.comment ?? "";
  }

  #saveDraft() {
    const controls = this.#getControls();
    const draft = this.#state.draft;
    if (controls?.feedback && draft.trim() !== this.#savedComment())
      controls.comment(draft);
  }

  #cancelClose() {
    if (this.#timer === undefined) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #update(patch: Partial<ɵFeedbackCommentState>) {
    const next = { ...this.#state, ...patch };
    const unchanged =
      next.open === this.#state.open &&
      next.draft === this.#state.draft &&
      next.focusRequest === this.#state.focusRequest &&
      next.anchor === this.#state.anchor;
    if (unchanged) return;
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }
}
