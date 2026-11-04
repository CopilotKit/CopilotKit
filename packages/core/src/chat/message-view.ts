import type { Message } from "@ag-ui/core";
import type {
  CopilotChatToolCallDisplay,
  ToolCallLayout,
  ToolCallRendererNames,
  TurnWork,
  WorkTime,
} from "./tool-call-layout";
import {
  getLatestTurnKey,
  getToolCallLayouts,
  getTurnWork,
  getWorkOpenState,
  isTurnWorkOpen,
  isTurnWorking,
  recordWorkTime,
} from "./tool-call-layout";

/** What the message view shows now. Each call to {@link ɵMessageViewModel.update} passes it. */
export interface ɵMessageViewInput {
  /** How assistant messages show tool calls. */
  display: CopilotChatToolCallDisplay;
  /** Every message, for tool-result lookups. */
  messages: readonly Message[];
  /** The messages that render, in the order they render (deduplicated, transformed). */
  rendered: readonly Message[];
  isRunning: boolean;
  /** From `ɵgetToolCallRendererNames`. */
  rendererNames: ToolCallRendererNames;
  /** The current time in epoch ms, for "Worked for 9s". */
  now: number;
}

const NO_LAYOUTS: ReadonlyMap<string, ToolCallLayout> = new Map();

/**
 * Whether the message list shows its loading cursor: while the agent runs,
 * except after a reasoning message (it shows its own loading state) and in
 * the `"turn"` display (its "Working" line is the progress indicator).
 *
 * @param state.lastMessage - The last message that renders, not the last one received.
 */
export function ɵshouldShowMessageCursor(state: {
  isRunning: boolean;
  lastMessage: Message | undefined;
  display: CopilotChatToolCallDisplay;
}) {
  return (
    state.isRunning &&
    state.lastMessage?.role !== "reasoning" &&
    state.display !== "turn"
  );
}

/**
 * The layout and turn state of a chat's message list: tool-call groups, the
 * `"turn"` display's work summaries, which work is open, and whether the
 * loading cursor shows. Framework-neutral: React, Vue and Angular call
 * {@link update} with what they render and draw the result.
 *
 * Every map in the result keeps its identity until an input it depends on
 * changes, so frameworks can hand them to memoized children. A user's
 * open/close of a reply's work ({@link toggleTurn}) notifies subscribers.
 *
 * @example
 * ```ts
 * const view = ɵcreateMessageViewModel();
 * const state = view.update({ display, messages, rendered, isRunning, rendererNames, now: Date.now() });
 * if (state.showCursor) drawCursor();
 * ```
 */
export class ɵMessageViewModel {
  private toggledTurns: ReadonlyMap<string, boolean> = new Map();
  private readonly workTimes = new Map<string, WorkTime>();
  private readonly listeners = new Set<() => void>();
  private layoutsCache:
    | {
        key: readonly unknown[];
        layouts: ReadonlyMap<string, ToolCallLayout>;
      }
    | undefined;
  private turnsCache:
    | {
        key: readonly unknown[];
        turnWork: ReadonlyMap<string, TurnWork> | undefined;
        turnByFirstMessage: ReadonlyMap<string, TurnWork>;
      }
    | undefined;
  private openCache:
    | {
        key: readonly unknown[];
        open: ReturnType<typeof getWorkOpenState>;
      }
    | undefined;
  private last: { isRunning: boolean; latestTurnKey: string } | undefined;

  /** Calls `listener` after the user opens or closes a reply's work. Returns the unsubscribe. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The turns the user opened (`true`) or closed (`false`) by hand. A new map after each toggle. */
  getSnapshot() {
    return this.toggledTurns;
  }

  /**
   * Lays out the list. Records run starts and ends for the `"turn"` display's
   * work time, so call it once per render with the current time.
   */
  update(input: ɵMessageViewInput) {
    const { display, messages, rendered, isRunning, rendererNames } = input;
    const layouts = this.layouts(display, rendered, messages, rendererNames);
    const { turnWork, turnByFirstMessage } = this.turns(
      display,
      rendered,
      layouts,
    );
    const latestTurnKey = getLatestTurnKey(rendered);
    const lastMessage = rendered[rendered.length - 1];
    if (display === "turn") {
      recordWorkTime(this.workTimes, {
        isRunning,
        latestTurnKey,
        lastMessageRole: lastMessage?.role,
        now: input.now,
      });
    }
    const { workOpen, workTextOpen } = this.workOpen(
      turnWork,
      isRunning,
      latestTurnKey,
    );
    this.last = { isRunning, latestTurnKey };

    return {
      layouts,
      turnByFirstMessage,
      latestTurnKey,
      workOpen,
      workTextOpen,
      showCursor: ɵshouldShowMessageCursor({ isRunning, lastMessage, display }),
      // Before the reply's first message, the "turn" display's summary sits
      // where the cursor would.
      pendingWorkSummary:
        display === "turn" && isRunning && lastMessage?.role === "user",
    };
  }

  /** Whether the agent works on this reply now. Uses the last {@link update}. */
  isTurnWorking(turnKey: string) {
    return this.last ? isTurnWorking(turnKey, this.last) : false;
  }

  /** Whether this reply's work shows. Uses the last {@link update}. */
  isTurnOpen(turnKey: string) {
    if (!this.last) return false;
    return isTurnWorkOpen(turnKey, {
      ...this.last,
      toggledTurns: this.toggledTurns,
    });
  }

  /** How long the agent worked on this reply, when this client watched it start. */
  getWorkTime(turnKey: string) {
    return this.workTimes.get(turnKey);
  }

  /** Opens a reply's work when it is closed, or closes it when it is open. */
  toggleTurn(turnKey: string) {
    this.toggledTurns = new Map(this.toggledTurns).set(
      turnKey,
      !this.isTurnOpen(turnKey),
    );
    for (const listener of this.listeners) listener();
  }

  /** Forgets the user's toggles and work times, for a new thread. */
  reset() {
    this.workTimes.clear();
    if (this.toggledTurns.size === 0) return;
    this.toggledTurns = new Map();
    for (const listener of this.listeners) listener();
  }

  private layouts(
    display: CopilotChatToolCallDisplay,
    rendered: readonly Message[],
    messages: readonly Message[],
    rendererNames: ToolCallRendererNames,
  ) {
    const key = [display, rendered, messages, rendererNames];
    if (this.layoutsCache && sameKey(this.layoutsCache.key, key)) {
      return this.layoutsCache.layouts;
    }
    const layouts =
      display === "separate"
        ? NO_LAYOUTS
        : getToolCallLayouts(rendered, messages, rendererNames);
    this.layoutsCache = { key, layouts };
    return layouts;
  }

  private turns(
    display: CopilotChatToolCallDisplay,
    rendered: readonly Message[],
    layouts: ReadonlyMap<string, ToolCallLayout>,
  ) {
    const key = [display, rendered, layouts];
    if (this.turnsCache && sameKey(this.turnsCache.key, key)) {
      return this.turnsCache;
    }
    const turnWork =
      display === "turn" ? getTurnWork(rendered, layouts) : undefined;
    const turnByFirstMessage = new Map<string, TurnWork>();
    const turns = turnWork?.values() ?? [];
    for (const turn of turns) turnByFirstMessage.set(turn.firstMessageId, turn);
    this.turnsCache = { key, turnWork, turnByFirstMessage };
    return this.turnsCache;
  }

  private workOpen(
    turnWork: ReadonlyMap<string, TurnWork> | undefined,
    isRunning: boolean,
    latestTurnKey: string,
  ) {
    const key = [turnWork, this.toggledTurns, isRunning, latestTurnKey];
    if (this.openCache && sameKey(this.openCache.key, key)) {
      return this.openCache.open;
    }
    const open = getWorkOpenState(turnWork?.values() ?? [], {
      toggledTurns: this.toggledTurns,
      isRunning,
      latestTurnKey,
    });
    this.openCache = { key, open };
    return open;
  }
}

function sameKey(a: readonly unknown[], b: readonly unknown[]) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Creates the model of a chat's message list. See {@link ɵMessageViewModel}. */
export function ɵcreateMessageViewModel() {
  return new ɵMessageViewModel();
}

/**
 * The development warning for messages that shared an id and were merged into
 * one row, or `null` when none were.
 *
 * @param messageCount - How many messages came in.
 * @param renderedCount - How many rows remain after deduplication.
 */
export function ɵduplicateMessagesWarning(
  messageCount: number,
  renderedCount: number,
) {
  const merged = messageCount - renderedCount;
  if (merged <= 0) return null;
  return `CopilotChatMessageView: Merged ${merged} message(s) with duplicate IDs.`;
}
