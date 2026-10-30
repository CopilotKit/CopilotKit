"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JevEvent, JevNotice, JevResult } from "@/jev/decide.server";
import type { UseCaseId } from "@/jev/usecases";

export type { JevEvent, JevNotice, JevResult };

export type JevRunState =
  | { phase: "idle" }
  | { phase: "running"; startedAt: number }
  | { phase: "painting"; startedAt: number; result: JevResult; responseMs: number }
  | { phase: "done"; startedAt: number; result: JevResult; responseMs: number; renderedMs: number }
  | { phase: "notice"; startedAt: number; notice: JevNotice; responseMs: number }
  | { phase: "error"; message: string };

/** `?fixture=1` answers from the saved fixture instead of calling Jev (for screenshots and UI work). */
export function useFixtureFlag() {
  const [fixture, setFixture] = useState(false);
  useEffect(() => {
    setFixture(new URLSearchParams(window.location.search).get("fixture") === "1");
  }, []);
  return fixture;
}

/**
 * Runs one Jev request and measures, on the client:
 *  - responseMs: submit to response (Jev plus the local hop),
 *  - renderedMs: submit to the A2UI surface painted in `host`.
 * Jev's own round trip (`result.jevMs`) is measured on the server around the gateway call.
 */
export function useJevRun(usecase: UseCaseId, opts: { stream?: boolean } = {}) {
  const stream = !!opts.stream;
  const fixture = useFixtureFlag();
  const [state, setState] = useState<JevRunState>({ phase: "idle" });
  /** Server steps as they arrive (stream mode only). */
  const [events, setEvents] = useState<JevEvent[]>([]);
  const host = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(
    async (prompt: string) => {
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      const startedAt = performance.now();
      setState({ phase: "running", startedAt });
      setEvents([]);
      try {
        const res = await fetch("/api/jev", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ usecase, prompt, fixture, stream }),
          signal: ctl.signal,
        });
        const body = stream && res.ok && res.body ? await readStream(res.body, (e) => setEvents((prev) => [...prev, e])) : ((await res.json()) as (JevResult | JevNotice) & { error?: string });
        if (!res.ok || body.error) throw new Error(body.error ?? `Request failed (${res.status})`);
        if ("notice" in body) setState({ phase: "notice", startedAt, notice: body, responseMs: performance.now() - startedAt });
        else setState({ phase: "painting", startedAt, result: body, responseMs: performance.now() - startedAt });
      } catch (err) {
        if (ctl.signal.aborted) return;
        setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      }
    },
    [usecase, fixture, stream],
  );

  // Rendered = the first frame after the surface's components are in the DOM.
  useEffect(() => {
    if (state.phase !== "painting") return;
    let raf = 0;
    let cancelled = false;
    const check = () => {
      if (cancelled) return;
      if (host.current?.querySelector(".a2-node")) {
        requestAnimationFrame(() => {
          if (cancelled) return;
          const renderedMs = performance.now() - state.startedAt;
          setState((s) => (s.phase === "painting" ? { ...s, phase: "done", renderedMs } : s));
        });
        return;
      }
      raf = requestAnimationFrame(check);
    };
    raf = requestAnimationFrame(check);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [state]);

  const result = state.phase === "painting" || state.phase === "done" ? state.result : null;
  return { state, result, run, host, fixture, events };
}

type StreamLine = ({ type: "event" } & JevEvent) | { type: "result"; result: JevResult } | { type: "notice"; notice: JevNotice } | { type: "error"; error: string };

/** Reads the NDJSON run stream: forwards each step as it arrives, resolves with the final line's payload. */
async function readStream(body: ReadableStream<Uint8Array>, onEvent: (e: JevEvent) => void): Promise<(JevResult | JevNotice) & { error?: string }> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as StreamLine;
      if (msg.type === "event") {
        const { type: _t, ...e } = msg;
        onEvent(e);
      } else if (msg.type === "result") return msg.result;
      else if (msg.type === "notice") return msg.notice;
      else return { error: msg.error } as JevNotice & { error: string };
    }
    if (done) throw new Error("The run stream ended early");
  }
}

/** 412 ms, or 1.24 s from a second up. */
export const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`);
