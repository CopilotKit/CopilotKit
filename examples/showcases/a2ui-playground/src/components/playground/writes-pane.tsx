"use client";

import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ArrowLeft } from "lucide-react";
import { highlightExpress, highlightJson } from "@/components/app/json-view";
import { cn } from "@/lib/utils";
import type { TimelineEvent } from "@/lib/run-store";
import { BuildPanel } from "./build-panel";
import { focusRing } from "./composer";
import { JsonTab } from "./json-tab";
import { activeId, kChars, useLink, type Shown, type ShownLine } from "./lines";

export type WritesTab = "lines" | "json" | "run";

const reducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Arrow keys, Home and End move through a tab list, choosing as they go (roving tabindex). */
function rovingKeyDown<T extends string>(
  e: KeyboardEvent<HTMLElement>,
  ids: readonly T[],
  current: T,
  select: (id: T) => void,
) {
  const i = ids.indexOf(current);
  const next =
    e.key === "ArrowRight" || e.key === "ArrowDown"
      ? ids[(i + 1) % ids.length]
      : e.key === "ArrowLeft" || e.key === "ArrowUp"
        ? ids[(i - 1 + ids.length) % ids.length]
        : e.key === "Home"
          ? ids[0]
          : e.key === "End"
            ? ids[ids.length - 1]
            : null;
  if (!next) return;
  e.preventDefault();
  select(next);
  e.currentTarget.parentElement
    ?.querySelector<HTMLElement>(`[data-roving="${next}"]`)
    ?.focus();
}

/** transitions.dev tabs sliding: the pill eases to the selected tab's box. */
function SlidingTabs({
  tabs,
  tab,
  onChange,
}: {
  tabs: Array<[WritesTab, string]>;
  tab: WritesTab;
  onChange: (t: WritesTab) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const ids = tabs.map(([t]) => t);
  const labels = tabs.map(([, l]) => l).join("|");
  useLayoutEffect(() => {
    const el = bar.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    setPill(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
  }, [tab, labels]);
  return (
    <div
      ref={bar}
      role="tablist"
      aria-label="What the model wrote"
      className="t-tabs wb-tabs flex-none"
    >
      <span
        className="t-tabs-pill"
        style={
          pill
            ? { width: pill.w, transform: `translateX(${pill.x}px)` }
            : { opacity: 0 }
        }
        aria-hidden
      />
      {tabs.map(([t, label]) => (
        <button
          key={t}
          id={`wb-tab-${t}`}
          data-tab={t}
          data-roving={t}
          role="tab"
          type="button"
          aria-selected={tab === t}
          aria-controls="wb-writes-panel"
          tabIndex={tab === t ? 0 : -1}
          onClick={() => onChange(t)}
          onKeyDown={(e) => rovingKeyDown(e, ids, tab, onChange)}
          className={cn("t-tab text-[13px] font-medium", focusRing)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * "<Model> writes": the lines of the selected surface as the model writes them (Express, or JSON for a
 * JSON run), the whole surface as JSON with the editor, and the run's timings. Beside the conversation
 * from 900px; on a phone it opens over it, with a way back.
 */
export const WritesPane = forwardRef<HTMLButtonElement, WritesPaneProps>(
  function WritesPane(
    {
      title,
      linesLabel,
      shown,
      tab,
      onTab,
      runId,
      recorded,
      jsonKey,
      jsonWide,
      onJsonWide,
      onBack,
      className,
    },
    backRef,
  ) {
    const tabs: Array<[WritesTab, string]> = [
      ["lines", linesLabel],
      ["json", "JSON"],
      ["run", "Run"],
    ];
    const count = shown.lines.filter((l) => l.kind === "line").length;
    return (
      <section
        aria-labelledby="wb-writes"
        className={cn("wb-col flex min-h-0 flex-col", className)}
        onKeyDown={(e) => {
          // Phones: Escape goes back to the conversation (unless something inside used it, like unpinning a line).
          if (
            e.key === "Escape" &&
            !e.defaultPrevented &&
            matchMedia("(max-width: 899px)").matches
          )
            onBack();
        }}
      >
        <div className="flex h-[52px] flex-none items-center justify-between gap-3 border-b border-[var(--pg-line)] px-5 max-[899px]:pl-2 max-[899px]:pr-4">
          <div className="flex min-w-0 items-center gap-1">
            <button
              ref={backRef}
              type="button"
              onClick={onBack}
              data-code-back
              className={cn(
                "inline-flex h-8 flex-none items-center gap-1.5 rounded-md px-2 text-[13.5px] font-medium text-[var(--pg-dim)] transition-colors hover:text-foreground min-[900px]:hidden",
                focusRing,
              )}
            >
              <ArrowLeft className="size-4" aria-hidden />
              Chat
            </button>
            <span
              aria-hidden
              className="mr-2 h-5 w-px flex-none bg-[var(--pg-line)] min-[900px]:hidden"
            />
            <h2
              id="wb-writes"
              className="truncate text-[14px] font-semibold text-foreground"
            >
              {title}
            </h2>
          </div>
          <span
            className="min-w-0 flex-none truncate font-mono text-[12px] text-[var(--pg-dim)]"
            data-lines-label
          >
            <span className={cn(count > 0 && "max-[1279px]:hidden")}>
              {shown.format === "json" ? "A2UI JSON" : "A2UI Express"}
            </span>
            {count ? <span className="max-[1279px]:hidden"> · </span> : null}
            {count ? `${count} ${count === 1 ? "line" : "lines"}` : ""}
          </span>
        </div>
        <div className="flex-none border-b border-[var(--pg-line)] px-4 py-2">
          <SlidingTabs tabs={tabs} tab={tab} onChange={onTab} />
        </div>
        <div
          id="wb-writes-panel"
          role="tabpanel"
          aria-labelledby={`wb-tab-${tab}`}
          className="flex min-h-0 flex-1 flex-col"
        >
          {tab === "lines" ? (
            <LinesView shown={shown} />
          ) : tab === "json" ? (
            <JsonTab
              key={jsonKey}
              wide={jsonWide}
              onWide={onJsonWide}
              jsonOnly
            />
          ) : recorded ? (
            <RecordedLog {...recorded} />
          ) : (
            <BuildPanel runId={runId} />
          )}
        </div>
      </section>
    );
  },
);

type WritesPaneProps = {
  title: string;
  linesLabel: string;
  shown: Shown;
  tab: WritesTab;
  onTab: (t: WritesTab) => void;
  runId: string | null | undefined;
  /** The replay's recorded events, while it shows. */
  recorded: {
    events: TimelineEvent[];
    recordedAt: string;
    model: string;
  } | null;
  jsonKey: number;
  jsonWide: boolean;
  onJsonWide: (wide: boolean) => void;
  /** Phones: back to the conversation. */
  onBack: () => void;
  className?: string;
};

function LinesView({ shown }: { shown: Shown }) {
  const link = useLink();
  const active = activeId(link);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lines = shown.lines;
  const ids = useMemo(
    () => lines.filter((l) => l.id).map((l) => l.key),
    [lines],
  );
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const tabbable = focusKey && ids.includes(focusKey) ? focusKey : ids[0];
  const count = lines.filter((l) => l.kind === "line").length;
  const where =
    shown.source === "recorded" || shown.source === "derived"
      ? "Recorded run."
      : null;

  // Follow the newest line while the model writes, unless the visitor scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current && shown.writing) el.scrollTop = el.scrollHeight;
  }, [lines.length, shown.writing]);

  // A component hovered in the conversation brings its line into view.
  useEffect(() => {
    if (link.hover?.from !== "surface" || !active) return;
    const el = scroller.current;
    const line = el?.querySelector<HTMLElement>(
      `[data-line-id="${CSS.escape(active)}"]`,
    );
    if (!el || !line) return;
    const top = line.offsetTop;
    if (
      top < el.scrollTop + 8 ||
      top + line.offsetHeight > el.scrollTop + el.clientHeight - 8
    ) {
      el.scrollTo({
        top: Math.max(0, top - el.clientHeight / 3),
        behavior: reducedMotion() ? "auto" : "smooth",
      });
    }
  }, [active, link.hover?.from]);

  const move = (e: KeyboardEvent<HTMLButtonElement>, key: string) => {
    const i = ids.indexOf(key);
    const next =
      e.key === "ArrowDown"
        ? ids[Math.min(ids.length - 1, i + 1)]
        : e.key === "ArrowUp"
          ? ids[Math.max(0, i - 1)]
          : e.key === "Home"
            ? ids[0]
            : e.key === "End"
              ? ids[ids.length - 1]
              : null;
    if (e.key === "Escape" && link.pinned) {
      e.preventDefault();
      link.togglePin(link.pinned);
      return;
    }
    if (!next) return;
    e.preventDefault();
    setFocusKey(next);
    scroller.current
      ?.querySelector<HTMLElement>(`[data-line-key="${next}"]`)
      ?.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {shown.note || where ? (
        <p
          className="flex-none border-b border-[var(--pg-line)] px-5 py-2.5 text-[12.5px] leading-snug text-[var(--pg-dim)] max-[899px]:px-4"
          data-lines-note
        >
          {[where, shown.note].filter(Boolean).join(" ")}
        </p>
      ) : null}
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="wb-scroll relative min-h-0 flex-1 overflow-y-auto py-3"
      >
        {lines.length ? (
          <ol
            aria-label="Lines the model wrote"
            className="wb-lines font-mono text-[13px] leading-[1.75]"
          >
            {lines.map((l) =>
              l.kind === "divider" ? (
                <li key={l.key} className="wb-divider">
                  <span>{l.text}</span>
                </li>
              ) : (
                <Line
                  key={l.key}
                  line={l}
                  active={!!l.id && l.id === active}
                  pinned={!!l.id && l.id === link.pinned}
                  tabbable={l.key === tabbable}
                  onKeyDown={move}
                  onFocusKey={setFocusKey}
                />
              ),
            )}
            {shown.writing ? (
              <li aria-hidden className="wb-line wb-line-plain">
                <span className="wb-ln">{count + 1}</span>
                <span className="wb-code">
                  <span className="wb-caret" />
                </span>
              </li>
            ) : null}
          </ol>
        ) : shown.status ? (
          <div className="px-5 max-[899px]:px-4" role="status">
            <p className="flex items-center gap-2.5 font-mono text-[13px] text-[var(--pg-dim)]">
              {shown.writing ? <span className="wb-caret" aria-hidden /> : null}
              <span>{shown.status}</span>
            </p>
          </div>
        ) : (
          <p className="px-5 text-[13.5px] leading-relaxed text-[var(--pg-dim)] max-[899px]:px-4">
            The model&apos;s lines show here as it writes them, one per
            component.
          </p>
        )}
      </div>
      {count ? (
        <div
          className="flex flex-none flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[var(--pg-line)] px-5 py-3 font-mono text-[12.5px] text-[var(--pg-dim)] max-[899px]:px-4"
          data-lines-footer
        >
          <span>{`${kChars(shown.chars)} characters${shown.writing ? " so far" : ""}`}</span>
          {shown.compare ? (
            <span>
              {shown.compare.label}: {kChars(shown.compare.chars)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Line({
  line,
  active,
  pinned,
  tabbable,
  onKeyDown,
  onFocusKey,
}: {
  line: ShownLine;
  active: boolean;
  pinned: boolean;
  tabbable: boolean;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>, key: string) => void;
  onFocusKey: (key: string) => void;
}) {
  const link = useLink();
  const html = useMemo(
    () =>
      line.format === "json"
        ? highlightJson(spacedJson(line.text))
        : highlightExpress(line.text),
    [line.text, line.format],
  );
  const body = (
    <>
      <span className="wb-ln">{line.n}</span>
      <code
        className={cn(
          "wb-code pg-json",
          line.format === "json" && "wb-code-json",
        )}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
  if (!line.id) return <li className="wb-line wb-line-plain">{body}</li>;
  const id = line.id;
  return (
    <li
      className="wb-line"
      data-active={active || undefined}
      data-pinned={pinned || undefined}
    >
      <button
        type="button"
        className="wb-line-btn"
        data-line-id={id}
        data-line-key={line.key}
        tabIndex={tabbable ? 0 : -1}
        aria-pressed={pinned}
        aria-label={`Line ${line.n}, ${id}${pinned ? ", pinned" : ""}`}
        // Pointer events, like the conversation's: mouse events would arrive after its pointerover and undo it.
        onPointerEnter={() => link.setHover({ id, from: "line" })}
        onPointerLeave={() => link.setHover(null)}
        onFocus={() => {
          onFocusKey(line.key);
          link.setHover({ id, from: "line" });
        }}
        onBlur={() => link.setHover(null)}
        onClick={() => link.togglePin(id)}
        onKeyDown={(e) => onKeyDown(e, line.key)}
      >
        {body}
      </button>
    </li>
  );
}

/** A component as compact JSON, with a space after each colon and comma so it wraps between values, not inside them. */
function spacedJson(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 1)
      .replace(/([[{])\n\s*/g, "$1")
      .replace(/\n\s*([\]}])/g, "$1")
      .replace(/\n\s*/g, " ");
  } catch {
    return text;
  }
}

const fmtMs = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;

/** The Run tab during the replay: the recorded events so far, at their recorded times. */
function RecordedLog({
  events,
  recordedAt,
  model,
}: {
  events: TimelineEvent[];
  recordedAt: string;
  model: string;
}) {
  const shown = events.filter((e) => e.kind !== "op");
  return (
    <div className="wb-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4 max-[899px]:px-4">
      <p className="mb-3 text-[13px] leading-snug text-[var(--pg-dim)]">
        A real {model} run, recorded on {recordedAt}. Times are from the
        recording. Your own runs show their timings here.
      </p>
      <ol className="space-y-0.5 font-mono text-[12.5px] leading-[1.7]">
        {shown.map((e, i) => (
          <li key={i} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3">
            <span className="tabular-nums text-[var(--pg-dim)]">
              {fmtMs(e.t)}
            </span>
            <span className="min-w-0">
              <span className="text-foreground/90">{e.label}</span>
              {e.detail ? (
                <span className="text-[var(--pg-dim)]"> {e.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
