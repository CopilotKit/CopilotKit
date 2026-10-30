/**
 * Send and stop rules for the chat input (the composer).
 *
 * These functions hold no state and touch no DOM. React, Vue, and Angular
 * call them so the three chat inputs make the same send or stop decision.
 */

/** What the chat input shows: the text box, the recorder, or a spinner. */
export type ɵComposerMode = "input" | "transcribe" | "processing";

/** What the chat input knows when it decides to send or stop. */
export interface ɵComposerInput {
  /** What the input shows. Default: `"input"`. */
  mode?: ɵComposerMode;
  /** `true` while the agent runs. */
  isRunning: boolean;
  /** The text in the input, before trimming. */
  value: string;
  /** `true` when the input has a handler that sends a message. */
  canSubmit: boolean;
  /** `true` when the input has a handler that stops the run. */
  canStop: boolean;
  /** `true` when the whole input is disabled. Send is off. Stop stays on. */
  disabled?: boolean;
  /** `true` while attached files upload. Send is off. Stop stays on. */
  attachmentsUploading?: boolean;
}

/**
 * Get the state of the send/stop button in the chat input.
 *
 * @param input - The current state of the chat input.
 * @returns
 * - `isProcessing`: the agent runs and the input does not record audio.
 * - `canSend`: the text is not empty and nothing blocks a send.
 * - `action`: `"stop"` when the button stops the run, else `"send"`.
 *   Use it for the icon, the label, and the click.
 * - `disabled`: `true` when a click does nothing.
 *
 * @example
 * ```ts
 * const button = ɵcomposerButtonState({
 *   mode: "input",
 *   isRunning: agent.isRunning,
 *   value: text,
 *   canSubmit: true,
 *   canStop: true,
 * });
 * // On click:
 * if (button.action === "stop") stopRun();
 * else if (button.canSend) sendMessage(text.trim());
 * ```
 */
export function ɵcomposerButtonState(input: ɵComposerInput) {
  const isProcessing = input.mode !== "transcribe" && input.isRunning;
  const isSendBlocked =
    input.disabled === true || input.attachmentsUploading === true;
  const canSend =
    input.canSubmit && !isSendBlocked && input.value.trim().length > 0;
  const showsStop = isProcessing && input.canStop;
  const action: "send" | "stop" = showsStop ? "stop" : "send";
  const disabled = isProcessing ? !input.canStop : !canSend;

  return { isProcessing, canSend, action, disabled };
}

/** The keyboard fields that {@link ɵresolveComposerKey} reads. */
export interface ɵComposerKeyEvent {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  /** `229` means the key is part of IME composition in some browsers. */
  keyCode?: number;
}

/**
 * Decide what a key press in the chat input does.
 *
 * This handles Enter only. Keys for the slash-command menu stay in each
 * framework, and the framework handles them before it calls this function.
 *
 * Results:
 * - `"send"`: send the trimmed text.
 * - `"stop"`: stop the run. This happens for Enter in an empty input while
 *   the agent runs. Text in the input always means send, not stop.
 * - `"newline"`: Shift+Enter. Let the browser add the line break.
 * - `"none"`: do nothing. Returned during IME composition, while the input
 *   is disabled, for keys other than Enter, and for an Enter that has
 *   nothing to send or stop.
 *
 * Call `preventDefault()` for every Enter without Shift that is not part of
 * IME composition, including when the result is `"none"`. This stops Enter
 * from adding a line break that the user cannot send.
 *
 * @param event - The keyboard event, or an object with the same fields.
 * @param input - The current state of the chat input.
 *
 * @example
 * ```ts
 * function onKeyDown(event: KeyboardEvent) {
 *   if (event.isComposing || event.keyCode === 229) return;
 *   // ...slash-command menu keys...
 *   const result = ɵresolveComposerKey(event, composerInput);
 *   if (event.key === "Enter" && !event.shiftKey) event.preventDefault();
 *   if (result === "send") sendMessage(composerInput.value.trim());
 *   if (result === "stop") stopRun();
 * }
 * ```
 */
export function ɵresolveComposerKey(
  event: ɵComposerKeyEvent,
  input: ɵComposerInput,
) {
  const isImeComposition = event.isComposing || event.keyCode === 229;
  const isBlocked = isImeComposition || input.disabled === true;
  if (isBlocked || event.key !== "Enter") {
    return "none";
  }
  if (event.shiftKey) {
    return "newline";
  }

  const button = ɵcomposerButtonState(input);
  const isEmpty = input.value.trim().length === 0;
  if (button.isProcessing && isEmpty) {
    return input.canStop ? "stop" : "none";
  }
  return button.canSend ? "send" : "none";
}
