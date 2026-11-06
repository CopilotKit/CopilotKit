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
 * `action`:
 * - `"send"`: send the trimmed text.
 * - `"stop"`: stop the run. This happens for Enter in an empty input while
 *   the agent runs. Text in the input always means send, not stop.
 * - `"newline"`: Shift+Enter. Let the browser add the line break.
 * - `"none"`: do nothing. Returned during IME composition, while the input
 *   is disabled, for keys other than Enter, and for an Enter that has
 *   nothing to send or stop.
 *
 * `preventDefault` is `true` for every Enter without Shift that is not part
 * of IME composition, also when `action` is `"none"`: Enter never adds a line
 * break that the user cannot send.
 *
 * @param event - The keyboard event, or an object with the same fields.
 * @param input - The current state of the chat input.
 *
 * @example
 * ```ts
 * function onKeyDown(event: KeyboardEvent) {
 *   // ...slash-command menu keys...
 *   const { action, preventDefault } = ɵresolveComposerKey(event, composerInput);
 *   if (preventDefault) event.preventDefault();
 *   if (action === "send") sendMessage(composerInput.value.trim());
 *   if (action === "stop") stopRun();
 * }
 * ```
 */
export function ɵresolveComposerKey(
  event: ɵComposerKeyEvent,
  input: ɵComposerInput,
): { action: ɵComposerKeyAction; preventDefault: boolean } {
  if (isImeComposition(event) || event.key !== "Enter") {
    return { action: "none", preventDefault: false };
  }
  if (event.shiftKey) {
    return { action: "newline", preventDefault: false };
  }
  return { action: resolveEnter(input), preventDefault: true };
}

/** What a key press in the chat input does. See {@link ɵresolveComposerKey}. */
export type ɵComposerKeyAction = "send" | "stop" | "newline" | "none";

/** `true` while the key is part of IME composition (for example CJK input). */
function isImeComposition(event: ɵComposerKeyEvent) {
  return event.isComposing || event.keyCode === 229;
}

/** What Enter without Shift does. */
function resolveEnter(input: ɵComposerInput) {
  if (input.disabled === true) return "none";
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

// ---------------------------------------------------------------------------
// Tools menu
// ---------------------------------------------------------------------------

/**
 * The tools menu the "+" button opens: the default "Add file" item first,
 * then the app's items. A separator goes between the two parts. Separators
 * next to each other become one, and separators at the start or end are
 * dropped. Nested groups stay as they are.
 *
 * @param toolsMenu - The app's items. `"-"` is a separator.
 * @param addFileItem - The default "Add file" item, or `undefined` when the
 *   chat takes no files.
 *
 * @example
 * ```ts
 * ɵnormalizeToolsMenu(["-", search, "-", "-", summarize, "-"], addFile);
 * // → [addFile, "-", search, "-", summarize]
 * ```
 */
export function ɵnormalizeToolsMenu<T>(
  toolsMenu: readonly (T | "-")[] | undefined,
  addFileItem?: T,
) {
  const items: (T | "-")[] = [];
  if (addFileItem !== undefined) items.push(addFileItem, "-");
  for (const item of toolsMenu ?? []) {
    const isRepeatedSeparator =
      item === "-" && (items.length === 0 || items[items.length - 1] === "-");
    if (!isRepeatedSeparator) items.push(item);
  }
  while (items[items.length - 1] === "-") items.pop();
  return items;
}

/** One row of a tools menu drawn as a flat list. */
export type ɵToolsMenuDisplayEntry =
  | { type: "separator"; key: string }
  | { type: "label"; key: string; label: string; depth: number }
  | {
      type: "item";
      key: string;
      label: string;
      depth: number;
      action: () => void;
    };

/**
 * The tools menu as a flat list of rows, for a menu that draws groups inline
 * instead of as submenus. A group becomes a label row followed by its items
 * one level deeper. Leaf items without an `action` are dropped. Each row has
 * a `key` that stays the same while the menu does.
 *
 * @param menu - The menu from {@link ɵnormalizeToolsMenu}.
 */
export function ɵflattenToolsMenuForDisplay<T extends ɵCommandMenuItem<T>>(
  menu: readonly (T | "-")[],
) {
  const walk = (
    items: readonly (T | "-")[],
    depth: number,
    prefix: string,
  ): ɵToolsMenuDisplayEntry[] =>
    items.flatMap((item, index): ɵToolsMenuDisplayEntry[] => {
      const key = `${prefix}-${index}`;
      if (item === "-") return [{ type: "separator", key: `sep-${key}` }];
      if (item.items && item.items.length > 0) {
        return [
          { type: "label", key: `label-${key}`, label: item.label, depth },
          ...walk(item.items, depth + 1, key),
        ];
      }
      if (!item.action) return [];
      return [
        {
          type: "item",
          key: `item-${key}`,
          label: item.label,
          depth,
          action: item.action,
        },
      ];
    });
  return walk(menu, 0, "root");
}

// ---------------------------------------------------------------------------
// Recorder and disclaimer
// ---------------------------------------------------------------------------

/** The parts of an audio recorder that {@link ɵsyncRecorderToMode} uses. */
export interface ɵModeRecorder {
  /** `"idle"`, `"recording"`, or another state of the recorder. */
  readonly state: string;
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
}

/**
 * Make the recorder follow the chat input's mode: it starts recording when
 * the mode is `"transcribe"` and it is idle, and it stops when the mode
 * changes while it records. Call it when the mode or the recorder changes.
 * Errors are logged, not thrown.
 *
 * @param recorder - The recorder, or `null` before it renders.
 * @param mode - The chat input's mode.
 */
export async function ɵsyncRecorderToMode(
  recorder: ɵModeRecorder | null | undefined,
  mode: ɵComposerMode,
) {
  if (!recorder) return;
  try {
    if (mode === "transcribe") {
      if (recorder.state === "idle") await recorder.start();
    } else if (recorder.state === "recording") {
      await recorder.stop();
    }
  } catch (error) {
    console.error(error);
  }
}

/**
 * Whether the chat input shows its disclaimer: as `showDisclaimer` says, or,
 * when it is not set, only when the input is pinned with absolute
 * positioning.
 */
export function ɵshowsComposerDisclaimer(options: {
  showDisclaimer?: boolean;
  positioning?: "static" | "absolute";
}) {
  return options.showDisclaimer ?? options.positioning === "absolute";
}

// ---------------------------------------------------------------------------
// Composer state
// ---------------------------------------------------------------------------

/** What the chat input shows. See {@link ɵComposerController}. */
export interface ɵComposerSnapshot<T> {
  /** The text in the input. */
  readonly value: string;
  /** The slash-menu query, or `null` while the slash menu is closed. */
  readonly slashQuery: string | null;
  /** The commands the slash menu lists for the query. */
  readonly slashCommands: readonly ɵRunnableCommand<T>[];
  /** The highlighted row of the slash menu, or `-1` when no row matches. */
  readonly slashHighlightIndex: number;
}

/** What the framework passes to {@link ɵComposerController.setInputs}. */
export interface ɵComposerControllerInputs<T> {
  /** The text when the app controls it, or `undefined` to keep it inside. */
  value: string | undefined;
  mode: ɵComposerMode;
  /** The tools menu, from {@link ɵnormalizeToolsMenu}. */
  menu: readonly (T | "-")[];
}

export interface ɵComposerControllerOptions {
  /** The starting text when the app does not control it. */
  initialValue?: string;
  /** Called with each new text: typing, and clearing after a send or command. */
  onChange?: (value: string) => void;
}

/** The result of {@link ɵComposerController.keyDown}. */
export interface ɵComposerKeyDownResult {
  /** Call `preventDefault()` on the event. */
  preventDefault: boolean;
  /**
   * `"send"` or `"stop"`: do that now. `"command"`: a slash command ran and
   * the input cleared; give the text box focus again.
   */
  action: ɵComposerKeyAction | "command";
}

/**
 * The text and slash-command menu of one chat input.
 *
 * - The text is the app's `value` when it sets one (controlled), else the
 *   controller keeps it. Every change calls `onChange`, in both cases.
 * - The slash menu opens while the text starts with `/` in input mode and
 *   the menu has commands. Escape, running a command, and leaving input mode
 *   close it until the text changes.
 * - The highlight goes to the first row when the query changes and stays on
 *   a row that exists when the list changes.
 *
 * Frameworks render from `getSnapshot()` and re-render when `subscribe()`
 * notifies. Call `setInputs()` whenever the app's value, the mode, or the
 * tools menu changes.
 *
 * @example
 * ```ts
 * const composer = new ɵComposerController({ onChange: emitChange });
 * composer.setInputs({ value: undefined, mode: "input", menu });
 * textarea.oninput = () => composer.setValue(textarea.value);
 * textarea.onkeydown = (event) => {
 *   const { preventDefault, action } = composer.keyDown(event, composerInput);
 *   if (preventDefault) event.preventDefault();
 *   if (action === "send") composer.submit(sendMessage);
 * };
 * ```
 */
export class ɵComposerController<T extends ɵCommandMenuItem<T>> {
  readonly #listeners = new Set<() => void>();
  readonly #onChange: ((value: string) => void) | undefined;
  #internalValue: string;
  #controlledValue: string | undefined;
  #mode: ɵComposerMode = "input";
  #menu: readonly (T | "-")[] = [];
  #commands: ɵRunnableCommand<T>[] = [];
  // The text the slash menu was closed for; it stays closed until the text
  // changes.
  #closedFor: string | null = null;
  #state: ɵComposerSnapshot<T>;

  constructor({
    initialValue = "",
    onChange,
  }: ɵComposerControllerOptions = {}) {
    this.#internalValue = initialValue;
    this.#onChange = onChange;
    this.#state = {
      value: initialValue,
      slashQuery: null,
      slashCommands: [],
      slashHighlightIndex: 0,
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

  /** Takes the app's value, the mode, and the tools menu. */
  setInputs = ({ value, mode, menu }: ɵComposerControllerInputs<T>) => {
    this.#controlledValue = value;
    if (menu !== this.#menu) {
      this.#menu = menu;
      this.#commands = ɵflattenCommandItems(menu);
    }
    if (mode !== this.#mode) {
      this.#mode = mode;
      if (mode !== "input") this.#closedFor = this.#value();
    }
    this.#refresh();
  };

  /** The user changed the text. */
  setValue = (value: string) => {
    if (this.#controlledValue === undefined) this.#internalValue = value;
    this.#onChange?.(value);
    this.#refresh();
  };

  /** Highlights row `index` of the slash menu, for example on hover. */
  highlight = (index: number) => {
    this.#refresh(index);
  };

  /** Closes the slash menu and keeps the text. */
  closeSlashMenu = () => {
    this.#closedFor = this.#value();
    this.#refresh();
  };

  /** Clears the text, closes the slash menu, and runs `command`. */
  runCommand = (command: T) => {
    this.#closedFor = this.#value();
    this.setValue("");
    command.action?.();
  };

  /**
   * Sends the trimmed text with `send` and then clears the input. Does
   * nothing for text that is only whitespace.
   *
   * @param send - Receives the trimmed text.
   * @param options.value - The text to send, when the framework has a newer
   *   one than the snapshot (a controlled value can lag a tick).
   * @param options.clear - Clear the input after sending. Default: `true`.
   * @returns Whether `send` was called.
   */
  submit = (
    send: (text: string) => void,
    {
      value = this.#value(),
      clear = true,
    }: { value?: string; clear?: boolean } = {},
  ) => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    send(trimmed);
    if (clear) this.setValue("");
    return true;
  };

  /**
   * Handles a key press in the text box: the slash-menu keys first, then
   * Enter as {@link ɵresolveComposerKey} decides.
   *
   * @param event - The keyboard event, or an object with the same fields.
   * @param input - The chat input's state for the send or stop decision.
   */
  keyDown = (
    event: ɵComposerKeyEvent,
    input: ɵComposerInput,
  ): ɵComposerKeyDownResult => {
    if (isImeComposition(event)) {
      return { preventDefault: false, action: "none" };
    }
    const slash = ɵresolveSlashKey(event, {
      query: this.#state.slashQuery,
      commands: this.#state.slashCommands,
      highlightIndex: this.#state.slashHighlightIndex,
    });
    switch (slash.type) {
      case "highlight":
        this.highlight(slash.index);
        return { preventDefault: true, action: "none" };
      case "run":
        this.runCommand(slash.command);
        return { preventDefault: true, action: "command" };
      case "close":
        this.closeSlashMenu();
        return { preventDefault: true, action: "none" };
      case "none":
        return ɵresolveComposerKey(event, input);
    }
  };

  #value() {
    return this.#controlledValue ?? this.#internalValue;
  }

  #refresh(highlight = this.#state.slashHighlightIndex) {
    const value = this.#value();
    if (this.#closedFor !== null && this.#closedFor !== value) {
      this.#closedFor = null;
    }
    const isOpen = this.#mode === "input" && this.#closedFor === null;
    const slashQuery = isOpen
      ? ɵparseSlashQuery(value, this.#commands.length > 0)
      : null;
    const slashCommands = ɵfilterCommands(this.#commands, slashQuery);
    const queryChanged = slashQuery !== this.#state.slashQuery;
    const slashHighlightIndex =
      slashQuery === null || (queryChanged && slashCommands.length > 0)
        ? 0
        : ɵclampSlashIndex(highlight, slashCommands.length);

    const previous = this.#state;
    const unchanged =
      value === previous.value &&
      slashQuery === previous.slashQuery &&
      slashHighlightIndex === previous.slashHighlightIndex &&
      slashCommands.length === previous.slashCommands.length &&
      slashCommands.every(
        (command, i) => command === previous.slashCommands[i],
      );
    if (unchanged) return;
    this.#state = { value, slashQuery, slashCommands, slashHighlightIndex };
    for (const listener of this.#listeners) listener();
  }
}
