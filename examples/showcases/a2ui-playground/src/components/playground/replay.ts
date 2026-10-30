"use client";

/**
 * The first visit: a real recorded Gemini run (src/data/replay.json, made by
 * scripts/record-replay.mjs) plays in all three columns. The prompt is typed,
 * then the lines and the surface arrive at their recorded times.
 *
 * The recording opens shortly before the model's first token: the seconds
 * before that are the router picking a tool, with nothing to see.
 *
 * Lines: a recording made with line capture carries them (`lines`, or `line`
 * on its op events) and those are used as they are. An older one has none,
 * so its final surface is decompiled to Express (POST /api/express) and each
 * line appears when the component it defines arrived.
 *
 * It plays only when this tab has no chat yet, and stops (showing the whole
 * recorded run) as soon as the visitor types, picks a suggestion or builds.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import data from "@/data/replay.json";
import { present, type Snapshot } from "@/lib/build-timeline";
import {
  latestComponents,
  type A2UIOp,
  type RunLine,
  type TimelineEvent,
} from "@/lib/run-store";
import { lineId } from "@/lib/express-lines";
import { modelLabel } from "@/lib/model-options";
import { useDecompiled } from "./json-tab";
import {
  decompiledLines,
  EMPTY_SHOWN,
  numbered,
  sentOf,
  type Shown,
} from "./lines";

type Recording = {
  prompt: string;
  recordedAt: string;
  firstFrameMs: number;
  totalMs: number;
  frames: Array<{ t: number; ops: A2UIOp[] }>;
  events: TimelineEvent[];
  lines?: RunLine[];
  model?: string;
};

const REC = data as unknown as Recording;
/** The chat key AgentTap keeps the session in: a tab with a chat skips the replay. */
const CHAT_KEY = "a2ui-playground-chat";

const SNAPS: Snapshot[] = REC.frames.map((f) => ({ t: f.t, ops: f.ops }));
const END = REC.frames[REC.frames.length - 1]?.t ?? REC.totalMs;
const FINAL_OPS = REC.frames[REC.frames.length - 1]?.ops ?? [];
const FIRST_TOKEN = REC.events.find((e) => e.label === "First token")?.t;
/** Where the recording's clock starts: just before the first token. */
const FROM = Math.max(0, (FIRST_TOKEN ?? REC.firstFrameMs ?? 0) - 400);
const OP_EVENTS = REC.events.filter((e) => e.kind === "op");
const opId = (e: TimelineEvent) => /^#([\w-]+)/.exec(e.detail ?? "")?.[1];

type Timed = {
  t: number;
  kind: "line" | "divider";
  text: string;
  id?: string;
  format: "express" | "json";
};

/** Lines the recording carries itself, or null when it has none. */
const RECORDED: Timed[] | null = REC.lines?.length
  ? REC.lines.map((l) => ({
      t: l.t,
      kind: l.kind,
      text: l.text,
      id: l.id,
      format: l.format ?? "express",
    }))
  : OP_EVENTS.some((e) => typeof e.line === "string")
    ? OP_EVENTS.filter((e) => typeof e.line === "string").map((e) => ({
        t: e.t,
        kind: "line" as const,
        text: e.line!,
        id: opId(e) ?? lineId(e.line!),
        format: "express" as const,
      }))
    : null;

/** When each component of the recording arrived: its op event, else the first frame that has it for real. */
const ARRIVED = (() => {
  const at = new Map<string, number>();
  for (const e of OP_EVENTS) {
    const id = opId(e);
    if (id && !at.has(id)) at.set(id, e.t);
  }
  for (const f of REC.frames)
    for (const c of latestComponents(f.ops))
      if (c.component !== "Blueprint" && !at.has(c.id)) at.set(c.id, f.t);
  return at;
})();

const reducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;
const TYPE_MS_PER_CHAR = 26;

export type ReplayStatus = "pending" | "off" | "playing" | "ended";

export type Replay = {
  status: ReplayStatus;
  prompt: string;
  /** The model that wrote the recording (older recordings do not say: they are Gemini Flash runs). */
  model: string;
  recordedAt: string;
  /** The prompt as typed so far, and whether it has been "sent". */
  typed: string;
  sent: boolean;
  ops: A2UIOp[] | null;
  /** A new value replays the paint-in. */
  runKey: string;
  shown: Shown;
  /** The recorded events so far, on the recording's own clock. */
  events: TimelineEvent[];
  stop: () => void;
  dismiss: () => void;
  restart: () => void;
};

export function useReplay(): Replay {
  const [status, setStatus] = useState<ReplayStatus>("pending");
  const [cycle, setCycle] = useState(0);
  // Replay time in ms; only re-rendered when something on screen changes (see `sig`).
  const [rt, setRt] = useState(0);
  const typeMs = useRef(0);

  useEffect(() => {
    let saved: unknown = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(CHAT_KEY) ?? "null");
    } catch {}
    setStatus(Array.isArray(saved) && saved.length ? "off" : "playing");
  }, []);

  useEffect(() => {
    if (status !== "playing") return;
    typeMs.current = reducedMotion() ? 0 : REC.prompt.length * TYPE_MS_PER_CHAR;
    const sendAt = typeMs.current + 250;
    const total = sendAt + (END - FROM) + 200;
    const start = performance.now();
    let last = "";
    let raf = 0;
    const tick = () => {
      const t = performance.now() - start;
      if (t >= total) {
        setRt(total);
        setStatus("ended");
        return;
      }
      const rec = t < sendAt ? -1 : FROM + (t - sendAt);
      const sig = [
        t < typeMs.current ? Math.floor(t / TYPE_MS_PER_CHAR) : -1,
        t >= sendAt,
        SNAPS.filter((s) => s.t <= rec).length,
        REC.events.filter((e) => e.t <= rec).length,
        (RECORDED ?? []).filter((l) => l.t <= rec).length,
      ].join("|");
      if (sig !== last) {
        last = sig;
        setRt(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status, cycle]);

  const ended = status === "ended";
  const sendAt = typeMs.current + 250;
  const recorded = ended ? END : rt < sendAt ? -1 : FROM + (rt - sendAt);
  const typed =
    ended || rt >= typeMs.current
      ? REC.prompt
      : REC.prompt.slice(0, Math.floor(rt / TYPE_MS_PER_CHAR));
  const sent = ended || rt >= sendAt;
  const p = useMemo(() => present(SNAPS, recorded), [recorded]);

  // Lines: the recording's own, else its final surface decompiled.
  const final = useMemo(() => (RECORDED ? null : sentOf(FINAL_OPS)), []);
  const finalJsonChars = useMemo(
    () => sentOf(FINAL_OPS)?.jsonChars ?? null,
    [],
  );
  const decompiled = useDecompiled(
    status === "off" || status === "pending" || !final ? null : final.json,
  );
  const timed = useMemo<Timed[] | null>(() => {
    if (RECORDED) return RECORDED;
    if (!final || !decompiled || "error" in decompiled) return null;
    const raw = decompiledLines(decompiled.express, final.ops);
    const firstAt = Math.min(
      ...raw.map((l) => (l.id ? (ARRIVED.get(l.id) ?? END) : END)),
    );
    // A line that defines no component (the surface, a data value) keeps its place after the line before it.
    let prev = firstAt;
    return raw
      .map((l, i) => {
        const t = l.id ? (ARRIVED.get(l.id) ?? END) : prev;
        prev = t;
        return { ...l, t, i };
      })
      .sort((a, b) => a.t - b.t || a.i - b.i)
      .map(({ i: _i, ...l }) => l as Timed);
  }, [final, decompiled]);

  const shown = useMemo<Shown>(() => {
    if (!sent) return EMPTY_SHOWN;
    const derived = !RECORDED;
    const note = derived
      ? "This recording has no line text, so its final UI is decompiled here. Each line appears when its component arrived."
      : null;
    if (!timed)
      return {
        ...EMPTY_SHOWN,
        writing: !ended,
        source: derived ? "derived" : "recorded",
        note,
        status: "Writing A2UI Express",
      };
    const visible = timed.filter((l) => l.t <= recorded);
    const { lines, lineOf } = numbered(visible.map(({ t: _t, ...l }) => l));
    const chars = visible.reduce(
      (a, l) => a + (l.kind === "line" ? l.text.length : 0),
      0,
    );
    return {
      lines,
      lineOf,
      format: "express",
      writing: !ended,
      source: derived ? "derived" : "recorded",
      note,
      status: lines.length ? null : "Writing A2UI Express",
      chars,
      compare:
        (ended || recorded >= END) && finalJsonChars
          ? { label: "the same UI as JSON", chars: finalJsonChars }
          : null,
    };
  }, [sent, timed, recorded, ended, finalJsonChars]);

  const events = useMemo(
    () => REC.events.filter((e) => e.t <= recorded),
    [recorded],
  );

  const stop = useCallback(
    () => setStatus((s) => (s === "playing" ? "ended" : s)),
    [],
  );
  const dismiss = useCallback(() => setStatus("off"), []);
  const restart = useCallback(() => {
    setRt(0);
    setCycle((c) => c + 1);
    setStatus("playing");
  }, []);

  return {
    status,
    prompt: REC.prompt,
    model: REC.model ? modelLabel(REC.model) : "Gemini Flash",
    recordedAt: REC.recordedAt,
    typed: status === "playing" || ended ? typed : "",
    sent,
    ops: p.ops,
    runKey: `replay-${cycle}`,
    shown,
    events,
    stop,
    dismiss,
    restart,
  };
}
