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
