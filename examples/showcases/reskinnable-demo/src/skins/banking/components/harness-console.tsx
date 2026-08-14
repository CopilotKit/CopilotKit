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
export const HarnessConsole = ({ channel }: { channel: string }) => {
  const [events, setEvents] = useState<HarnessProgressEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const source = new EventSource(
      `/api/banking/v1/dev/harness-progress/${channel}`,
    );
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as HarnessProgressEvent;
      setEvents((previous) => [...previous, event]);
      // A terminal frame is the only clean close: without it the browser keeps
      // reconnecting to a channel that will never speak again.
      if (event.kind === "done" || event.kind === "error") source.close();
    };
    source.onerror = () => source.close();
    return () => source.close();
  }, [channel]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
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
