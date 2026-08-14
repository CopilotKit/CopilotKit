import type { HarnessProgressEvent } from "./types";

/**
 * ARM A ONLY. The side-channel that makes a `defineTool` harness run visible.
 *
 * WHY IT EXISTS: `defineTool`'s contract is
 * `execute?: (args) => Promise<unknown>` — one input, one resolved output, no
 * emit callback, no context parameter (`packages/runtime/src/agent/index.ts:311`);
 * the only event emitted around a tool is its result (`index.ts:1722`). A tool
 * handler therefore has NO channel into the run's AG-UI stream, so a naked tool
 * renders as TOOL_CALL_START → minutes of silence → TOOL_CALL_RESULT.
 *
 * WHY IT IS DELIBERATELY IN-PROCESS AND NON-DURABLE: the property being compared
 * is that harness progress never enters the thread, so a mid-run reload loses
 * it. A durable store (Redis, the REST ledger) would paper over exactly that and
 * the reviewer would judge Arm A on a strength it does not have. Keep it in
 * memory; one dev/demo instance is the only target.
 *
 * Arm C needs none of this — the converter puts these events in the thread. If
 * Arm C wins, delete this file, its route, and `harness-console.tsx`.
 */

interface Channel {
  buffer: HarnessProgressEvent[];
  listeners: Set<(event: HarnessProgressEvent) => void>;
}

const channels = new Map<string, Channel>();

const channelFor = (id: string): Channel => {
  const existing = channels.get(id);
  if (existing) return existing;
  const created: Channel = { buffer: [], listeners: new Set() };
  channels.set(id, created);
  return created;
};

/**
 * Append one frame and fan it out to any live tail.
 *
 * The fan-out is DEFENSIVE on purpose. A tail's listener is the SSE route's
 * `controller.enqueue`, and enqueueing on a stream the client has already
 * dropped THROWS. This is called from inside the harness's `for await` loop,
 * which has an error handler — so an unguarded throw here would end a
 * four-minute run as a failure because a viewer closed a tab. A listener that
 * throws is therefore dropped, not rethrown, and never blocks the listeners
 * after it.
 */
export const publishProgress = (
  id: string,
  event: HarnessProgressEvent,
): void => {
  const channel = channelFor(id);
  channel.buffer.push(event);
  for (const listener of channel.listeners) {
    try {
      listener(event);
    } catch {
      // Deleting the current entry mid-iteration is safe for a Set.
      channel.listeners.delete(listener);
    }
  }
};

/**
 * The backlog. The SSE route replays this before tailing, so a client
 * connecting a second into the run does not miss the opening frames.
 */
export const readProgress = (id: string): HarnessProgressEvent[] => [
  ...channelFor(id).buffer,
];

/** Tail live frames. Returns the unsubscribe. */
export const subscribeProgress = (
  id: string,
  listener: (event: HarnessProgressEvent) => void,
): (() => void) => {
  const channel = channelFor(id);
  channel.listeners.add(listener);
  return () => {
    channel.listeners.delete(listener);
  };
};

/**
 * Drop a channel's buffer so a long-lived dev server does not grow, and so a
 * second run does not replay the first run's frames (whose trailing `done` would
 * close a fresh console immediately). Called by the tool at run START.
 *
 * It clears the buffer IN PLACE and deliberately KEEPS the listeners. Deleting
 * the map entry instead would throw away the console that is already tailing:
 * the run's frames would land in a freshly-interned channel with an empty
 * listener set, so that console would show nothing and never see `done`, leaving
 * its stream open forever.
 */
export const clearProgress = (id: string): void => {
  channelFor(id).buffer.length = 0;
};
