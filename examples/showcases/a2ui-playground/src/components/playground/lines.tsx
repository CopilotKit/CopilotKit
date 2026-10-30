"use client";

/**
 * What the writes pane shows, and the link between a line and the
 * component it made in the conversation.
 *
 *  - `Shown`: the numbered lines for the run on screen. Live while the model
 *    writes (the agent's `compose:component` events), as written once it is
 *    done, or decompiled from the surface by `POST /api/express` when no
 *    model wrote any (a template, a hand edit, a run from an earlier visit).
 *  - `LinkContext`: the component id under the pointer or keyboard focus, on
 *    either side, and the one pinned with Enter or a click.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  identifierRenames,
  lineId,
  splitStatements,
} from "@/lib/express-lines";
import {
  latestComponents,
  type A2UIOp,
  type RunLine,
  type RunRecord,
} from "@/lib/run-store";
import { useDecompiled } from "./json-tab";
import { sendable } from "./sendable";

export type LineFormat = "express" | "json";
export type ShownLine = {
  key: string;
  kind: "line" | "divider";
  text: string;
  id?: string;
  format: LineFormat;
  n?: number;
};

export type Shown = {
  lines: ShownLine[];
  /** The format of the latest line (an Express run that fell back to JSON ends in JSON). */
  format: LineFormat;
  /** The model is writing: the block caret shows after the last line. */
  writing: boolean;
  source: "live" | "written" | "decompiled" | "recorded" | "derived" | "none";
  /** Where the lines come from, when they are not what the model wrote live. */
  note: string | null;
  /** What is happening before the first line arrives. */
  status: string | null;
  chars: number;
  /** The same surface in the other format, measured. */
  compare: { label: string; chars: number } | null;
  /** Component id -> the number of the line that defines it (its latest attempt). */
  lineOf: Map<string, number>;
};

export const kChars = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

type RawLine = Omit<ShownLine, "key" | "n">;

/** Numbers the lines (dividers take no number) and maps each component id to its line. */
export function numbered(raw: RawLine[]): {
  lines: ShownLine[];
  lineOf: Map<string, number>;
} {
  let n = 0;
  const lineOf = new Map<string, number>();
  const lines = raw.map((l, i): ShownLine => {
    if (l.kind === "divider") return { ...l, key: `d${i}` };
    n++;
    if (l.id) lineOf.set(l.id, n);
    return { ...l, key: `l${i}`, n };
  });
  return { lines, lineOf };
}

export const EMPTY_SHOWN: Shown = {
  lines: [],
  format: "express",
  writing: false,
  source: "none",
  note: null,
  status: null,
  chars: 0,
  compare: null,
  lineOf: new Map(),
};

/** The surface as one createSurface, as it would be sent, and its size in JSON. */
export function sentOf(ops: A2UIOp[] | null | undefined) {
  if (!ops?.length) return null;
  const sent = sendable(ops);
  if (!sent.components) return null;
  return {
    ops: sent.ops,
    json: JSON.stringify(sent.ops),
    jsonChars: JSON.stringify(sent.ops[0]).length,
  };
}

/** Decompiled Express as lines, each mapped back to its component (ids that were not identifiers were renamed for Express). */
export function decompiledLines(express: string, ops: A2UIOp[]): RawLine[] {
  const back = new Map(
    [...identifierRenames(latestComponents(ops).map((c) => c.id))].map(
      ([id, name]) => [name, id],
    ),
  );
  // The surface header and the playground's own `_meta` bookkeeping are not lines a model writes.
  return splitStatements(express)
    .filter((text) => !/^(surface\(|\$\/_meta\/)/.test(text.trim()))
    .map((text) => {
      const name = lineId(text);
      return {
        kind: "line",
        text,
        id: name ? (back.get(name) ?? name) : undefined,
        format: "express",
      };
    });
}

const STATUS_KINDS = new Set(["route", "tool", "data", "compose", "skeleton"]);
const NO_LINES: RunLine[] = [];

/** What a run is doing: its latest step ("First token" is a timing mark, not a step). */
export const runStatus = (run: RunRecord) =>
  [...run.events]
    .reverse()
    .find((e) => STATUS_KINDS.has(e.kind) && e.label !== "First token")
    ?.label ?? "Sending the prompt";

/**
 * The lines of a run, or of a surface no model wrote line by line (`ops`, decompiled).
 * `handEdited`: the surface came from the JSON editor, for the note.
 */
export function useShownLines({
  run,
  ops,
  handEdited,
}: {
  run: RunRecord | undefined;
  ops: A2UIOp[] | null;
  handEdited: boolean;
}): Shown {
  const running = run?.status === "running";
  const written = run?.lines ?? NO_LINES;
  const sent = useMemo(
    () => (running || written.length ? null : sentOf(ops)),
    [running, written.length, ops],
  );
  const decompiled = useDecompiled(sent ? sent.json : null);

  return useMemo<Shown>(() => {
    if (written.length) {
      const { lines, lineOf } = numbered(
        written.map((l: RunLine) => ({
          kind: l.kind,
          text: l.text,
          id:
            l.id ?? (l.kind === "line" ? lineId(l.text, l.format) : undefined),
          format: l.format ?? "express",
        })),
      );
      const format: LineFormat =
        [...written].reverse().find((l) => l.kind === "line")?.format ??
        "express";
      const chars = written.reduce(
        (a, l) => a + (l.kind === "line" ? l.text.length : 0),
        0,
      );
      const p = run?.payload;
      const compare =
        !running && p
          ? p.format === "json"
            ? p.expressChars
              ? { label: "the same UI in Express", chars: p.expressChars }
              : null
            : { label: "the same UI as JSON", chars: p.jsonChars }
          : null;
      return {
        lines,
        lineOf,
        format,
        writing: running,
        source: running ? "live" : "written",
        note: null,
        status: null,
        chars: p && !running ? p.outputChars : chars,
        compare,
      };
    }
    if (running) {
      const status =
        run?.path === "fixed"
          ? "Template picked. The model fills in data only, so it writes no lines."
          : run
            ? runStatus(run)
            : "Sending the prompt";
      return {
        ...EMPTY_SHOWN,
        writing: run?.path !== "fixed",
        source: "live",
        status,
        format: run?.format === "json" ? "json" : "express",
      };
    }
    if (!sent) return EMPTY_SHOWN;
    const note =
      run?.path === "fixed"
        ? "Decompiled from a template: the model picked it and filled in the data."
        : handEdited
          ? "Decompiled from the JSON you edited."
          : !run
            ? "Decompiled from the surface. The model's own lines are kept for runs since this page opened."
            : "Decompiled from the surface.";
    if (!decompiled)
      return {
        ...EMPTY_SHOWN,
        source: "decompiled",
        note,
        status: "Decompiling",
      };
    if ("error" in decompiled)
      return {
        ...EMPTY_SHOWN,
        source: "decompiled",
        note: `This surface could not be written as Express: ${decompiled.error}`,
      };
    const { lines, lineOf } = numbered(
      decompiledLines(decompiled.express, sent.ops),
    );
    return {
      lines,
      lineOf,
      format: "express",
      writing: false,
      source: "decompiled",
      note,
      status: null,
      chars: decompiled.express.length,
      compare: { label: "the same UI as JSON", chars: sent.jsonChars },
    };
  }, [written, running, run, sent, decompiled, handEdited]);
}

/* ───────────────────────── line <-> component ───────────────────────── */

type Hover = { id: string; from: "line" | "surface" };
type Link = {
  hover: Hover | null;
  pinned: string | null;
  setHover: (h: Hover | null) => void;
  togglePin: (id: string) => void;
};

export const LinkContext = createContext<Link>({
  hover: null,
  pinned: null,
  setHover: () => {},
  togglePin: () => {},
});
export const useLink = () => useContext(LinkContext);
/** The component lit on both sides: the one under the pointer or focus, else the pinned one. */
export const activeId = (l: Pick<Link, "hover" | "pinned">) =>
  l.hover?.id ?? l.pinned;

export function useLinkState(): Link {
  const [hover, setHoverState] = useState<Hover | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const setHover = useCallback(
    (h: Hover | null) =>
      setHoverState((cur) =>
        cur?.id === h?.id && cur?.from === h?.from ? cur : h,
      ),
    [],
  );
  const togglePin = useCallback(
    (id: string) => setPinned((p) => (p === id ? null : id)),
    [],
  );
  return useMemo(
    () => ({ hover, pinned, setHover, togglePin }),
    [hover, pinned, setHover, togglePin],
  );
}
