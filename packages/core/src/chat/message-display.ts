import type { UserMessage } from "@ag-ui/core";
import { copyToClipboard } from "@copilotkit/shared";
import type {
  AudioInputPart,
  DocumentInputPart,
  ImageInputPart,
  VideoInputPart,
} from "@copilotkit/shared";
import { ɵformatCountLabel, ɵformatLabel } from "./labels";
import type { CopilotChatLabels } from "./labels";
import {
  countFailedToolCalls,
  formatReasoningDuration,
  formatWorkDuration,
} from "./tool-call-layout";
import type { ToolCallEntry } from "./tool-call-layout";

/**
 * How long the model reasoned, as label text: "a few seconds", "4 seconds",
 * "2 minutes", or "1m 5s".
 *
 * @param seconds - The elapsed time in seconds. It may have a fraction.
 * @param labels - The chat labels that hold the duration texts.
 */
export function ɵformatReasoningDurationLabel(
  seconds: number,
  labels: CopilotChatLabels,
) {
  const duration = formatReasoningDuration(seconds);
  switch (duration.unit) {
    case "fewSeconds":
      return labels.reasoningMessageDurationFewSeconds;
    case "seconds":
      return ɵformatLabel(labels.reasoningMessageDurationSeconds, {
        count: duration.seconds,
      });
    case "minutes":
      return ɵformatCountLabel(duration.minutes, {
        one: labels.reasoningMessageDurationMinutesOne,
        other: labels.reasoningMessageDurationMinutesOther,
      });
    case "minutesSeconds":
      return ɵformatLabel(labels.reasoningMessageDurationMinutesSeconds, {
        minutes: duration.minutes,
        seconds: duration.seconds,
      });
  }
}

/**
 * The header text of a reasoning message: `labels.reasoningMessageThinkingLabel`
 * while the model reasons, then `labels.reasoningMessageThoughtForLabel`
 * ("Thought for 4 seconds").
 *
 * @param state - Whether the model still reasons, and for how long it did.
 * @param labels - The chat labels.
 */
export function ɵgetReasoningHeaderLabel(
  state: Pick<ɵReasoningDisclosureState, "isStreaming" | "elapsedSeconds">,
  labels: CopilotChatLabels,
) {
  if (state.isStreaming) return labels.reasoningMessageThinkingLabel;
  return ɵformatLabel(labels.reasoningMessageThoughtForLabel, {
    duration: ɵformatReasoningDurationLabel(state.elapsedSeconds, labels),
  });
}

/** What a reasoning message shows. See {@link ɵReasoningDisclosure}. */
export interface ɵReasoningDisclosureState {
  /** The model is reasoning in this message now. */
  readonly isStreaming: boolean;
  /** The reasoning text shows. */
  readonly isOpen: boolean;
  /**
   * Seconds since the model started reasoning. It grows every tick while the
   * model reasons and stays at the final time after. `0` for a message that
   * never streamed here, such as one loaded from history.
   */
  readonly elapsedSeconds: number;
}

/** Options for {@link ɵReasoningDisclosure}. */
export interface ɵReasoningDisclosureOptions {
  /** Whether the message streams when it first renders. Default: `false`. */
  isStreaming?: boolean;
  /** How often the elapsed time updates while streaming, in ms. Default: 1000. */
  tickMs?: number;
}

/**
 * The open state and reasoning timer of one reasoning message.
 *
 * - It opens when streaming starts and closes by itself when it ends,
 *   unless the user toggled it during that stream: then their choice stays.
 *   Each new stream starts open again and forgets the earlier toggle.
 * - The elapsed time counts from the first stream start and updates every
 *   tick while streaming. When streaming ends it takes the final time.
 *
 * Frameworks render from `getSnapshot()` and re-render when `subscribe()`
 * notifies. Call `setStreaming()` whenever the streaming state may have
 * changed, including once after mount. Call `dispose()` on unmount. The
 * controller stays usable after `dispose()`, so a remount (React Strict
 * Mode) can keep it: the next `setStreaming(true)` starts the timer again.
 *
 * @example
 * ```ts
 * const disclosure = new ɵReasoningDisclosure({ isStreaming });
 * disclosure.subscribe(() => render(disclosure.getSnapshot()));
 * disclosure.setStreaming(isStreaming);
 * // Header click, when the message has text:
 * disclosure.toggle();
 * ```
 */
export class ɵReasoningDisclosure {
  readonly #listeners = new Set<() => void>();
  readonly #tickMs: number;
  #state: ɵReasoningDisclosureState;
  #startedAt: number | null = null;
  #userToggled = false;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor({
    isStreaming = false,
    tickMs = 1000,
  }: ɵReasoningDisclosureOptions = {}) {
    this.#tickMs = tickMs;
    // Not streaming until `setStreaming(true)`, which starts the timer; it
    // only opens now, so the first render shows the right state.
    this.#state = {
      isStreaming: false,
      isOpen: isStreaming,
      elapsedSeconds: 0,
    };
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

  /** Tells the controller whether the model reasons in this message now. */
  setStreaming = (isStreaming: boolean) => {
    if (isStreaming) {
      // After `dispose()` a remount restarts the timer of a running stream.
      if (this.#timer === undefined) this.#startTimer();
      if (this.#state.isStreaming) return;
      this.#startedAt ??= Date.now();
      this.#userToggled = false;
      this.#update({ isStreaming: true, isOpen: true });
      return;
    }
    if (!this.#state.isStreaming) return;
    this.#stopTimer();
    this.#update({
      isStreaming: false,
      elapsedSeconds: this.#elapsed(),
      isOpen: this.#userToggled ? this.#state.isOpen : false,
    });
  };

  /** Opens or closes the reasoning text, and keeps that after the stream. */
  toggle = () => {
    this.#userToggled = true;
    this.#update({ isOpen: !this.#state.isOpen });
  };

  /** Stops the timer. */
  dispose = () => {
    this.#stopTimer();
  };

  #elapsed() {
    return this.#startedAt === null ? 0 : (Date.now() - this.#startedAt) / 1000;
  }

  #startTimer() {
    this.#timer = setInterval(() => {
      this.#update({ elapsedSeconds: this.#elapsed() });
    }, this.#tickMs);
  }

  #stopTimer() {
    if (this.#timer === undefined) return;
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  #update(patch: Partial<ɵReasoningDisclosureState>) {
    const next = { ...this.#state, ...patch };
    const unchanged =
      next.isStreaming === this.#state.isStreaming &&
      next.isOpen === this.#state.isOpen &&
      next.elapsedSeconds === this.#state.elapsedSeconds;
    if (unchanged) return;
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }
}

/** Input for {@link ɵgetWorkSummaryText}. */
export interface ɵWorkSummaryInput {
  /** The agent is still working on this reply. */
  isWorking: boolean;
  /** The tool calls the reply made. */
  calls: readonly ToolCallEntry[];
  /** Time worked on the reply over its runs, in ms, when known. */
  elapsedMs?: number;
  /** When the current run started (epoch ms), while the agent works. */
  workingSince?: number;
  /** The current time (epoch ms); re-read it every second while working. */
  now: number;
  labels: CopilotChatLabels;
}

/**
 * The text of the work summary line at the top of a reply in the `"turn"`
 * tool-call display.
 *
 * - While working: `label` is "Working" and `detail` the live timer ("4s"),
 *   or `null` when the elapsed time is not known.
 * - When done with a known time: `label` is "Worked for 9s" (at least 1s)
 *   and `detail` the tool count ("7 tools").
 * - When done without a time: `label` is "Used 7 tools" and `detail` `null`.
 * - `failed` is "2 failed" when tool calls failed, otherwise `null`. It is
 *   always `null` while working.
 */
export function ɵgetWorkSummaryText({
  isWorking,
  calls,
  elapsedMs,
  workingSince,
  now,
  labels,
}: ɵWorkSummaryInput) {
  if (isWorking) {
    const isTimed = elapsedMs !== undefined && workingSince !== undefined;
    return {
      label: labels.workSummaryWorkingLabel,
      detail: isTimed
        ? formatWorkDuration(elapsedMs + Math.max(0, now - workingSince))
        : null,
      failed: null,
    };
  }
  const failedCount = countFailedToolCalls(calls);
  const failed =
    failedCount > 0
      ? ɵformatLabel(labels.toolCallFailedCountLabel, { count: failedCount })
      : null;
  if (elapsedMs === undefined) {
    return {
      label: ɵformatCountLabel(calls.length, {
        one: labels.toolCallUsedToolsOne,
        other: labels.toolCallUsedToolsOther,
      }),
      detail: null,
      failed,
    };
  }
  // A finished reply worked for at least a second.
  const duration = formatWorkDuration(Math.max(1000, elapsedMs));
  return {
    label: ɵformatLabel(labels.workSummaryWorkedForLabel, { duration }),
    detail: ɵformatCountLabel(calls.length, {
      one: labels.toolCallToolCountOne,
      other: labels.toolCallToolCountOther,
    }),
    failed,
  };
}

/** An attachment part of a user message. */
export type ɵUserMessageMediaPart =
  | ImageInputPart
  | AudioInputPart
  | VideoInputPart
  | DocumentInputPart;

/**
 * The text of a user message: the string content, or its text parts joined
 * by newlines. Parts that are not text, and malformed parts from untyped
 * data, add nothing.
 */
export function ɵflattenUserMessageContent(content?: UserMessage["content"]) {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .map((part) =>
      part?.type === "text" && typeof part.text === "string" ? part.text : "",
    )
    .filter((text) => text.length > 0)
    .join("\n");
}

const isMediaPart = (
  part: Exclude<UserMessage["content"], string>[number],
): part is ɵUserMessageMediaPart =>
  part?.type === "image" ||
  part?.type === "audio" ||
  part?.type === "video" ||
  part?.type === "document";

/** The image, audio, video, and document parts of a user message. */
export function ɵgetUserMessageMediaParts(content?: UserMessage["content"]) {
  if (!content || typeof content === "string") return [];
  return content.filter(isMediaPart);
}

/** The file name stored in an attachment's `metadata.filename`, if any. */
export function ɵgetUserMessageMediaFilename(part: ɵUserMessageMediaPart) {
  const meta = part.metadata;
  const hasFilename =
    meta != null &&
    typeof meta === "object" &&
    "filename" in meta &&
    typeof meta.filename === "string";
  return hasFilename ? meta.filename : undefined;
}

/** Input for {@link ɵgetBranchNavState}. */
export interface ɵBranchNavInput {
  /** The shown branch, from 0. */
  branchIndex: number;
  numberOfBranches: number;
  /** Whether something handles a switch to another branch. */
  canSwitch: boolean;
}

/**
 * Whether a user message shows its branch navigation and which arrows work.
 * It shows only with more than one branch and a switch handler: without the
 * handler the arrows would do nothing.
 */
export function ɵgetBranchNavState({
  branchIndex,
  numberOfBranches,
  canSwitch,
}: ɵBranchNavInput) {
  const show = canSwitch && numberOfBranches > 1;
  return {
    show,
    canGoPrev: show && branchIndex > 0,
    canGoNext: show && branchIndex < numberOfBranches - 1,
  };
}

/** Whether an assistant message has text beyond whitespace. */
export function ɵhasAssistantMessageText(content: string | undefined) {
  return !!content && content.trim().length > 0;
}

/** Input for {@link ɵshouldShowAssistantToolbar}. */
export interface ɵAssistantToolbarInput {
  /** The app or chat shows toolbars at all. */
  toolbarVisible: boolean;
  /** The message has text (see {@link ɵhasAssistantMessageText}). */
  hasContent: boolean;
  /** The Inspector shortcut shows, which gives a toolbar a use without text. */
  showInspectorShortcut: boolean;
  /** The agent is running. */
  isRunning: boolean;
  /** The message is the latest one in the chat. */
  isLatest: boolean;
}

/**
 * Whether an assistant message shows its toolbar: when toolbars are on, the
 * message has text or the Inspector shortcut shows, and the message is not
 * the one still streaming (the latest while the agent runs).
 */
export function ɵshouldShowAssistantToolbar({
  toolbarVisible,
  hasContent,
  showInspectorShortcut,
  isRunning,
  isLatest,
}: ɵAssistantToolbarInput) {
  const isStreaming = isRunning && isLatest;
  return (
    toolbarVisible && (hasContent || showInspectorShortcut) && !isStreaming
  );
}

/** How long a copy button shows its "copied" check mark, in ms. */
export const ɵCOPY_FEEDBACK_RESET_MS = 2000;

/**
 * The "copied" state of a copy button. After a copy it is `true` for
 * {@link ɵCOPY_FEEDBACK_RESET_MS}; another copy in that time restarts the
 * wait, so rapid clicks do not flicker.
 *
 * Frameworks render from `getSnapshot()` and re-render when `subscribe()`
 * notifies. Call `dispose()` on unmount. The controller stays usable after
 * `dispose()`, so a remount (React Strict Mode) can keep it.
 *
 * @example
 * ```ts
 * const feedback = new ɵCopyFeedback();
 * feedback.subscribe(() => render(feedback.getSnapshot()));
 * await feedback.copy(text);
 * ```
 */
export class ɵCopyFeedback {
  readonly #listeners = new Set<() => void>();
  readonly #resetMs: number;
  #copied = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor({
    resetMs = ɵCOPY_FEEDBACK_RESET_MS,
  }: { resetMs?: number } = {}) {
    this.#resetMs = resetMs;
  }

  /** Whether the check mark shows. */
  getSnapshot = () => this.#copied;

  /** Calls `listener` when the state changes. Returns the unsubscribe function. */
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Shows the check mark, or keeps it for the full time again. */
  markCopied = () => {
    this.#clearTimer();
    this.#set(true);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#set(false);
    }, this.#resetMs);
  };

  /**
   * Copies `text` to the clipboard and shows the check mark on success.
   * Empty text copies nothing.
   *
   * @returns Whether the text was copied.
   */
  copy = async (text: string) => {
    if (!text) return false;
    const copied = await copyToClipboard(text);
    if (copied) this.markCopied();
    return copied;
  };

  /** Stops the reset timer. */
  dispose = () => {
    this.#clearTimer();
  };

  #clearTimer() {
    if (this.#timer === undefined) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #set(copied: boolean) {
    if (copied === this.#copied) return;
    this.#copied = copied;
    for (const listener of this.#listeners) listener();
  }
}
