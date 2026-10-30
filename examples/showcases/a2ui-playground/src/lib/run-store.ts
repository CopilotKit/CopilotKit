"use client";

/**
 * Client-side record of everything the playground shows besides the chat:
 * the A2UI v1.0 operations of every surface (for the json tab and the
 * canvas), and a timestamped event timeline per run (for the stream tab +
 * path view).
 */
import { useSyncExternalStore } from "react";

export type A2UIOp = Record<string, unknown>;

export type SurfaceRecord = {
  key: string; // activity message id (`genui:<surfaceId>`)
  surfaceId: string;
  ops: A2UIOp[];
  runId: string | null;
  firstPaintAt: number | null;
  updatedAt: number;
  componentCount: number;
};

/** `line`: on an `op` event, the text the model wrote for that component (recordings keep it). */
export type TimelineEvent = {
  t: number;
  kind: string;
  label: string;
  detail?: string;
  tone?: "fixed" | "dynamic" | "data" | "paint" | "muted" | "error";
  line?: string;
};

/**
 * One line the model wrote, as it arrived: an Express statement, or one component as JSON.
 * A `divider` marks where the writing started over (Express retried, or rewritten as JSON).
 */
export type RunLine = {
  t: number;
  kind: "line" | "divider";
  text: string;
  id?: string;
  component?: string;
  format?: "express" | "json";
};

/** What a composed surface cost (the agent's `format:stats` mark). */
export type PayloadStats = {
  format: "json" | "express";
  model: string;
  outputChars: number;
  jsonChars: number;
  expressChars: number;
  wireChars: number;
  firstTokenMs: number | null;
  composeMs: number;
  macros: number;
  /** The Express text the model wrote (Express runs only). */
  express?: string;
};

export type RunRecord = {
  id: string;
  prompt: string;
  mode: string;
  /** The model picked for the run (`gemini`, `gemma`, `gpt`) and the format the composer wrote. */
  model: string | null;
  format: string | null;
  router: string | null;
  composer: string | null;
  payload: PayloadStats | null;
  macros: Array<{ id: string; macro: string; components: number }>;
  startedAt: number;
  events: TimelineEvent[];
  path: "fixed" | "dynamic" | "text" | null;
  tool: string | null;
  /** First blueprint frame on screen (fixed: template skeleton at tool pick; dynamic: first component id). */
  firstFrameMs: number | null;
  /** First real content (a non-Blueprint leaf component) on screen. */
  firstPaintMs: number | null;
  totalMs: number | null;
  /** Composer stream stats (dynamic). */
  tps: number | null;
  tokens: number | null;
  openId: string | null;
  openChars: number;
  /** Recorded snapshots for replay (landing demo): ms since prompt + ops. */
  frames: Array<{ t: number; key: string; ops: A2UIOp[] }>;
  serverPaintMs: number | null;
  /** `stopped`: the visitor pressed Stop (or left the page) before the run finished. */
  status: "running" | "done" | "error" | "stopped";
  surfaceKey: string | null;
  /** Why the run failed, written for a visitor (the chat shows it with a Retry button). */
  error: string | null;
  /** The user message that started the run, so the run history can find the run of each prompt. */
  messageId: string | null;
  /** What the model wrote, line by line, as it arrived (composed runs). */
  lines: RunLine[];
};

type State = {
  surfaces: Record<string, SurfaceRecord>;
  surfaceOrder: string[];
  runs: RunRecord[];
  selected: string | null;
};

let state: State = { surfaces: {}, surfaceOrder: [], runs: [], selected: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  emit();
};

export function surfaceIdOf(ops: A2UIOp[]): string {
  for (const op of ops) {
    for (const k of [
      "createSurface",
      "updateComponents",
      "updateDataModel",
      "deleteSurface",
    ]) {
      const sid = (op[k] as { surfaceId?: string } | undefined)?.surfaceId;
      if (sid) return sid;
    }
  }
  return "surface";
}

const LAYOUT = new Set([
  "Column",
  "Row",
  "Grid",
  "Card",
  "Section",
  "List",
  "Tabs",
]);

/** Components that carry content (not a Blueprint frame, not a container). */
export function contentCount(ops: A2UIOp[]) {
  const comps = latestComponents(ops);
  return comps.filter(
    (c) => c.component !== "Blueprint" && !LAYOUT.has(String(c.component)),
  ).length;
}

type Comp = { id: string; component: string } & Record<string, unknown>;

/**
 * The components of a surface after its operations: A2UI 1.0
 * `updateComponents` upserts by id, so a Blueprint frame and the component
 * that replaces it are one entry, in the order ids first appeared.
 */
export function latestComponents(ops: A2UIOp[]): Comp[] {
  const byId = new Map<string, Comp>();
  const add = (list: unknown) => {
    if (Array.isArray(list))
      for (const c of list as Comp[])
        if (c && typeof c.id === "string") byId.set(c.id, c);
  };
  for (const op of ops) {
    if (op.createSurface || op.deleteSurface) byId.clear();
    add((op.createSurface as { components?: unknown } | undefined)?.components);
    add(
      (op.updateComponents as { components?: unknown } | undefined)?.components,
    );
  }
  return [...byId.values()];
}

/** The data model of a surface after its operations (`createSurface.dataModel`, then each `updateDataModel`). */
export function latestData(ops: A2UIOp[]): Record<string, unknown> {
  let data: Record<string, unknown> = {};
  for (const op of ops) {
    const create = op.createSurface as
      | { dataModel?: Record<string, unknown> }
      | undefined;
    if (create) data = { ...(create.dataModel ?? {}) };
    const update = op.updateDataModel as
      | { path?: string; value?: unknown }
      | undefined;
    if (!update) continue;
    const segments = (update.path ?? "/").split("/").filter(Boolean);
    if (!segments.length) {
      data =
        update.value && typeof update.value === "object"
          ? { ...(update.value as Record<string, unknown>) }
          : {};
      continue;
    }
    let cur: Record<string, unknown> = data;
    for (const seg of segments.slice(0, -1))
      cur = (cur[seg] =
        cur[seg] && typeof cur[seg] === "object"
          ? { ...(cur[seg] as Record<string, unknown>) }
          : {}) as Record<string, unknown>;
    cur[segments[segments.length - 1]] = update.value;
  }
  return data;
}

const countComponents = (ops: A2UIOp[]) => latestComponents(ops).length;

export const runStore = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  startRun(
    prompt: string,
    mode: string,
    choice: { model?: string; format?: string; messageId?: string } = {},
  ) {
    const run: RunRecord = {
      id: `run-${Date.now()}`,
      prompt,
      mode,
      model: choice.model ?? null,
      format: choice.format ?? null,
      router: null,
      composer: null,
      payload: null,
      macros: [],
      startedAt: performance.now(),
      events: [
        {
          t: 0,
          kind: "prompt",
          label: "Prompt sent",
          detail: prompt,
          tone: "muted",
        },
      ],
      path: null,
      tool: null,
      firstFrameMs: null,
      firstPaintMs: null,
      totalMs: null,
      tps: null,
      tokens: null,
      openId: null,
      openChars: 0,
      frames: [],
      serverPaintMs: null,
      status: "running",
      surfaceKey: null,
      error: null,
      messageId: choice.messageId ?? null,
      lines: [],
    };
    set({ runs: [...state.runs, run].slice(-30) });
    return run.id;
  },

  current(): RunRecord | undefined {
    return state.runs[state.runs.length - 1];
  },

  patchRun(
    id: string,
    patch: Partial<RunRecord> | ((r: RunRecord) => Partial<RunRecord>),
  ) {
    set({
      runs: state.runs.map((r) =>
        r.id === id
          ? { ...r, ...(typeof patch === "function" ? patch(r) : patch) }
          : r,
      ),
    });
  },

  addEvent(e: Omit<TimelineEvent, "t"> & { t?: number }) {
    const run = runStore.current();
    if (!run || run.status !== "running") return;
    const t = e.t ?? Math.round(performance.now() - run.startedAt);
    runStore.patchRun(run.id, (r) => ({ events: [...r.events, { ...e, t }] }));
  },

  /** Adds a line the model wrote to the running run. */
  addLine(line: Omit<RunLine, "t">) {
    const run = runStore.current();
    if (!run || run.status !== "running") return;
    const t = Math.round(performance.now() - run.startedAt);
    runStore.patchRun(run.id, (r) => ({ lines: [...r.lines, { ...line, t }] }));
  },

  upsertSurface(key: string, ops: A2UIOp[]) {
    const prev = state.surfaces[key];
    const now = performance.now();
    const run = runStore.current();
    const rec: SurfaceRecord = {
      key,
      surfaceId: surfaceIdOf(ops),
      ops,
      runId: prev?.runId ?? (run?.status === "running" ? run.id : null),
      firstPaintAt: prev?.firstPaintAt ?? now,
      updatedAt: now,
      componentCount: countComponents(ops),
    };
    const order = state.surfaceOrder.includes(key)
      ? state.surfaceOrder
      : [...state.surfaceOrder, key];
    set({
      surfaces: { ...state.surfaces, [key]: rec },
      surfaceOrder: order,
      selected: key,
    });
    const updatedInPlace = !!prev && !!run && prev.runId !== run.id;
    if (!run || run.status !== "running") return;
    const ms = Math.round(now - run.startedAt);
    const content = contentCount(ops);
    const events: TimelineEvent[] = [];
    const patch: Partial<RunRecord> = {
      frames: [...run.frames, { t: ms, key, ops }].slice(-400),
      surfaceKey: key,
    };
    if (run.firstFrameMs == null && (!prev || updatedInPlace)) {
      patch.firstFrameMs = ms;
      events.push({
        t: ms,
        kind: "frame",
        label: updatedInPlace
          ? "Updating surface in place"
          : content
            ? "Surface painted"
            : "Blueprint drawn",
        detail: `${rec.surfaceId}, ${rec.componentCount} slots`,
        tone: "paint",
      });
    }
    if (
      run.firstPaintMs == null &&
      content > 0 &&
      (!prev || updatedInPlace || prev.runId === run.id)
    ) {
      patch.firstPaintMs = ms;
      if (
        !(
          run.firstFrameMs == null &&
          (!prev || updatedInPlace) &&
          events.length &&
          events[0].label === "Surface painted"
        )
      ) {
        events.push({
          t: ms,
          kind: "paint",
          label: updatedInPlace
            ? "Surface updated in place"
            : "First content filled",
          detail: `${content} of ${rec.componentCount} components`,
          tone: "paint",
        });
      }
    }
    runStore.patchRun(run.id, (r) => ({
      ...patch,
      events: [...r.events, ...events],
    }));
    if (updatedInPlace)
      set({
        surfaces: { ...state.surfaces, [key]: { ...rec, runId: run.id } },
      });
  },

  select(key: string | null) {
    set({ selected: key });
  },

  /**
   * Ends a running run, once: `done` (an error the agent reported along the
   * way turns it into `error`), `error` with a visitor message, or `stopped`.
   */
  endRun(id: string, status: "done" | "error" | "stopped", error?: string) {
    const run = state.runs.find((r) => r.id === id);
    if (!run || run.status !== "running") return;
    const t = Math.round(performance.now() - run.startedAt);
    const final = status === "done" && run.error ? "error" : status;
    const reason =
      final === "error"
        ? (error ?? run.error ?? "The run failed. Try again.")
        : null;
    const label =
      final === "error"
        ? "Run failed"
        : final === "stopped"
          ? "Stopped"
          : "Run finished";
    runStore.patchRun(id, {
      status: final,
      totalMs: t,
      error: reason,
      path: run.path ?? (final === "done" ? "text" : null),
      events: [
        ...run.events,
        {
          t,
          kind: "done",
          label,
          ...(reason ? { detail: reason } : {}),
          tone: final === "error" ? "error" : "muted",
        },
      ],
    });
  },

  /** Forgets every run and surface: the chat started over. */
  reset() {
    set({ surfaces: {}, surfaceOrder: [], runs: [], selected: null });
  },
};

export function useRunStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    runStore.subscribe,
    () => selector(state),
    () => selector(state),
  );
}

if (typeof window !== "undefined") {
  (window as unknown as { __runStore: typeof runStore }).__runStore = runStore;
}
