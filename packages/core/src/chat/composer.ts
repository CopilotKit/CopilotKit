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

// ---------------------------------------------------------------------------
// Slash-command menu
// ---------------------------------------------------------------------------

/**
 * One entry of the chat input's tools menu, as the framework packages type
 * it: a leaf with an `action`, or a group with nested `items`. `"-"` in a
 * list is a separator.
 */
export interface ɵCommandMenuItem<T> {
  label: string;
  action?: () => void;
  items?: readonly (T | "-")[];
}

/** A menu item that has an action to run. */
export type ɵRunnableCommand<T> = T & { action: () => void };

function isRunnableCommand<T extends ɵCommandMenuItem<T>>(
  item: T,
): item is ɵRunnableCommand<T> {
  return typeof item.action === "function";
}

/**
 * Flatten the tools menu into the list of commands the slash menu shows.
 *
 * Groups are opened, separators are dropped, and only the first item with a
 * given label is kept. Leaf items without an `action` are skipped, because
 * picking one would do nothing.
 *
 * @param menu - The tools menu, for example `[addFileItem, ...toolsMenu]`.
 *
 * @example
 * ```ts
 * const commands = ɵflattenCommandItems([
 *   { label: "Attach", action: attach },
 *   "-",
 *   { label: "More", items: [{ label: "Summarize", action: summarize }] },
 * ]);
 * // → [Attach, Summarize]
 * ```
 */
export function ɵflattenCommandItems<T extends ɵCommandMenuItem<T>>(
  menu: readonly (T | "-")[],
) {
  const commands: ɵRunnableCommand<T>[] = [];
  const seen = new Set<string>();

  const walk = (entries: readonly (T | "-")[]) => {
    for (const entry of entries) {
      if (entry === "-") continue;
      const nested = entry.items;
      if (nested && nested.length > 0) {
        walk(nested);
        continue;
      }
      if (!isRunnableCommand(entry) || seen.has(entry.label)) continue;
      seen.add(entry.label);
      commands.push(entry);
    }
  };

  walk(menu);
  return commands;
}

/**
 * Filter slash commands by the text typed after `/`.
 *
 * The match ignores case and surrounding spaces. Labels that start with the
 * query come first, then labels that contain it, each group in menu order.
 *
 * @param commands - The commands from {@link ɵflattenCommandItems}.
 * @param query - The query from {@link ɵparseSlashQuery}. `null` means the
 *   menu is closed and gives an empty list. An empty query gives every
 *   command.
 */
export function ɵfilterCommands<T extends { label: string }>(
  commands: readonly T[],
  query: string | null,
) {
  if (query === null) return [];
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return [...commands];

  const startsWith: T[] = [];
  const contains: T[] = [];
  for (const command of commands) {
    const label = command.label.toLowerCase();
    if (label.startsWith(normalized)) startsWith.push(command);
    else if (label.includes(normalized)) contains.push(command);
  }
  return [...startsWith, ...contains];
}

/**
 * Read the slash-command query from the chat input's text.
 *
 * @param value - The text in the chat input.
 * @param hasCommands - `false` when the menu has no commands. The slash menu
 *   then never opens.
 * @returns The text of the first line after a leading `/`, or `null` when
 *   the text does not start with `/` (the menu is closed).
 *
 * @example
 * ```ts
 * ɵparseSlashQuery("/sum\nmore text", true); // "sum"
 * ɵparseSlashQuery("hello /sum", true); // null
 * ```
 */
export function ɵparseSlashQuery(value: string, hasCommands: boolean) {
  if (!hasCommands || !value.startsWith("/")) return null;
  const firstLine = value.split(/\r?\n/, 1)[0] ?? "";
  return firstLine.slice(1);
}

/**
 * Move the slash menu highlight one row, wrapping at both ends.
 *
 * @param index - The highlighted row. `-1` means no row.
 * @param length - The number of rows. With `0` rows the index stays.
 * @param direction - `"down"` for ArrowDown, `"up"` for ArrowUp.
 */
export function ɵnextSlashIndex(
  index: number,
  length: number,
  direction: "up" | "down",
) {
  if (length === 0) return index;
  if (direction === "down") return index < 0 ? 0 : (index + 1) % length;
  return index <= 0 ? length - 1 : index - 1;
}

/**
 * Keep the slash menu highlight on a row that exists.
 *
 * @param index - The highlighted row.
 * @param length - The number of rows.
 * @returns `-1` when there are no rows, `index` when it is a row, else `0`.
 */
export function ɵclampSlashIndex(index: number, length: number) {
  if (length === 0) return -1;
  return index >= 0 && index < length ? index : 0;
}

/** What {@link ɵresolveSlashKey} reads about the open slash menu. */
export interface ɵSlashMenuState<T> {
  /** The query from {@link ɵparseSlashQuery}. `null` when the menu is closed. */
  query: string | null;
  /** The commands the menu shows, from {@link ɵfilterCommands}. */
  commands: readonly T[];
  /** The highlighted row, or `-1`. */
  highlightIndex: number;
}

/**
 * What a key press does in the slash menu.
 *
 * - `"none"`: the menu does not use the key. Give it to
 *   {@link ɵresolveComposerKey}.
 * - `"highlight"`: highlight row `index`.
 * - `"run"`: run `command`, clear the input, and close the menu.
 * - `"close"`: close the menu and keep the text.
 *
 * For every result except `"none"`, call `preventDefault()`.
 */
export type ɵSlashKeyResult<T> = ReturnType<typeof ɵresolveSlashKey<T>>;

/**
 * Decide what a key press does while the slash menu is open.
 *
 * ArrowDown and ArrowUp move the highlight and wrap. Enter runs the
 * highlighted command; with no highlighted command it is `"none"`, so the
 * text sends as usual. Escape closes the menu.
 *
 * @param event - The keyboard event, or an object with its `key`.
 * @param state - The menu state.
 *
 * @example
 * ```ts
 * const result = ɵresolveSlashKey(event, { query, commands, highlightIndex });
 * if (result.type !== "none") event.preventDefault();
 * if (result.type === "run") runCommand(result.command);
 * ```
 */
export function ɵresolveSlashKey<T>(
  event: Pick<ɵComposerKeyEvent, "key">,
  state: ɵSlashMenuState<T>,
) {
  const none = { type: "none" } as const;
  if (state.query === null) return none;
  const length = state.commands.length;

  switch (event.key) {
    case "ArrowDown":
    case "ArrowUp": {
      if (length === 0) return none;
      const direction = event.key === "ArrowDown" ? "down" : "up";
      return {
        type: "highlight",
        index: ɵnextSlashIndex(state.highlightIndex, length, direction),
      } as const;
    }
    case "Enter": {
      const command =
        state.highlightIndex >= 0
          ? state.commands[state.highlightIndex]
          : undefined;
      return command === undefined ? none : ({ type: "run", command } as const);
    }
    case "Escape":
      return { type: "close" } as const;
    default:
      return none;
  }
}
