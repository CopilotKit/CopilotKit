"use client";

import { useEffect, useRef, useState } from "react";
import type { HarnessProgressEvent } from "@/skins/banking/harness/types";

/**
 * ARM A ONLY. Tails one channel's side-channel and renders it as a live harness
 * console — the component that buys back the visible thinking, tool calls, and
 * navigation a `defineTool` cannot put in the transcript.
 *
 * It also embodies Arm A's cost: this state lives in component state, not in the
 * thread, so a refresh mid-run empties it permanently.
 *
 * NOT a firehose. The harness emits short bold headline summaries (e.g.
 * `**Searching exact address**`) roughly every seven seconds, so this is a
 * slowly-growing list of one-liners rather than a character stream — appending a
 * whole array per frame is the right shape, and no batching or virtualisation is
 * warranted.
 *
 * There is no unit test: `EventSource` is a browser API jsdom does not implement,
 * and stubbing it would only prove the stub. The live run is the verification.
 */

/**
 * How close to the tail counts as "following the run". Generous enough that a
 * viewer who is merely a line short of the bottom still gets carried along.
 */
const NEAR_BOTTOM_PX = 40;

const isNearBottom = (element: HTMLDivElement | null): boolean =>
  element === null ||
  element.scrollHeight - element.scrollTop - element.clientHeight <=
    NEAR_BOTTOM_PX;

export const HarnessConsole = ({ channel }: { channel: string }) => {
  const [events, setEvents] = useState<HarnessProgressEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * Whether to carry the view to the tail on the NEXT frame. Sampled while the
   * frame arrives rather than after it renders, and it starts `true` so a console
   * nobody has touched follows the run.
   */
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const source = new EventSource(
      `/api/banking/v1/dev/harness-progress/${channel}`,
    );
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as HarnessProgressEvent;
      // Sampled HERE, before React appends the line — this is the only moment the
      // measurement means anything. Once the DOM has grown, the distance to the
      // bottom includes the line just added, so a viewer who scrolled up to
      // re-read something is indistinguishable from one sitting at the tail and
      // the guard would always read "at the bottom".
      stickToBottomRef.current = isNearBottom(scrollRef.current);
      setEvents((previous) => [...previous, event]);
      // A terminal frame is the only clean close: without it the browser keeps
      // reconnecting to a channel that will never speak again.
      if (event.kind === "done" || event.kind === "error") source.close();
    };
    source.onerror = () => source.close();
    return () => source.close();
  }, [channel]);

  useEffect(() => {
    // Never yank the viewport back down: a headline lands every ~7s across a
    // multi-minute run, so unconditional autoscroll would snap a reader back to
    // the tail within seconds of scrolling up — during the very run they are
    // trying to follow.
    if (!stickToBottomRef.current) return;
    const element = scrollRef.current;
    // `scrollTop = scrollHeight` rather than `scrollTo({...})`: equivalent here,
    // and jsdom implements the property but NOT `Element.prototype.scrollTo`, so
    // the method form throws in any test that renders this component.
    if (element) element.scrollTop = element.scrollHeight;
  }, [events]);

  return (
    <div
      ref={scrollRef}
      className="max-h-64 overflow-y-auto rounded-[--radius] border border-hairline bg-canvas p-3 font-mono text-xs"
    >
      {events.length === 0 ? (
        <div className="text-ink/50">Starting the harness…</div>
      ) : null}
      {events.map((event, index) => (
        <div key={index} className="py-0.5">
          {event.kind === "thinking" ? (
            <span className="text-ink/60">{event.text}</span>
          ) : null}
          {event.kind === "tool" ? (
            <span className="text-brand">
              ▸ {event.label}
              {event.detail ? (
                <span className="text-ink/50"> {event.detail}</span>
              ) : null}
            </span>
          ) : null}
          {event.kind === "navigate" ? (
            <span className="text-ink">→ {event.href}</span>
          ) : null}
          {event.kind === "error" ? (
            <span className="text-negative">✕ {event.message}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
};
