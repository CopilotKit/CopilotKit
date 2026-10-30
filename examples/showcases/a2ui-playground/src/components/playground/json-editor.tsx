"use client";

/**
 * The JSON tab's editing mode: a hand-rolled code editor over the A2UI v1.0
 * operations and a live preview next to it, with no model involved. Each
 * edit is parsed and validated (debounced) and, when valid, re-rendered by
 * the same engine the chat uses. While the text is broken the preview keeps
 * the last valid version.
 */
import { Component, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Check, ChevronDown, CircleAlert, CircleCheck, Copy, Maximize2, Minimize2, Pencil, RotateCcw, TriangleAlert } from "lucide-react";
import { standardUI } from "@copilotkit/react-core/v2/generative-ui";
import { playgroundUI } from "@/a2ui/catalog/catalog";
import { highlightJson } from "@/components/app/json-view";
import { StaticGenUIProvider, StaticSurface } from "@/components/app/static-surface";
import { cn } from "@/lib/utils";
import type { A2UIOp, SurfaceRecord } from "@/lib/run-store";
import { AskModel } from "./ask-model";
import { analyzeOps, lineColOf, manifestOf, type Analysis, type Problem } from "./json-analyze";
import { starters } from "./json-starters";
import { sendable } from "./sendable";

const DEBOUNCE_MS = 200;
const LINE_PX = 20;
const PAD_PX = 12;
const AGENT = "agent";

/** Shared look of the small bordered header buttons. */
export const headerButton =
  "inline-flex h-7 flex-none items-center gap-1.5 rounded-md border border-[var(--pg-line)] px-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

/** The Edit toggle, at the left of the JSON tab header in both modes. */
export function EditToggle({ pressed, onClick }: { pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} data-json-edit-toggle className={cn(headerButton, pressed && "border-[var(--pg-line-strong)] bg-[var(--pg-raised)] text-foreground")}>
      <Pencil className="size-3" />
      Edit
    </button>
  );
}

/** `agentKey`: the agent surface that was selected when the text was loaded. */
type Session = { source: string; base: string; text: string; agentKey: string | null };

/**
 * Survives the tab switching away and back (the tab unmounts): whether the
 * tab is in edit mode and what is in the editor.
 */
export const editorMemory: { editing: boolean; session: Session | null } = { editing: false, session: null };

const pretty = (ops: A2UIOp[]) => JSON.stringify(ops, null, 2);

type Good = { ops: A2UIOp[]; fingerprint: string; surfaceId: string | null; version: number };

export function JsonEditPane({ surface, wide, onWide, onExit }: { surface: SurfaceRecord | undefined; wide: boolean; onWide: (wide: boolean) => void; onExit: () => void }) {
  const list = starters();
  // The agent's surface as it would be sent: its Blueprint frames are not A2UI and never reach the editor.
  const agentText = useMemo(() => (surface ? pretty(sendable(surface.ops, surface.surfaceId).ops) : null), [surface]);
  const originalOf = (source: string) => (source === AGENT ? agentText : pretty(list.find((s) => s.id === source)?.ops ?? list[0].ops));

  const agentKey = surface?.key ?? null;
  const [session, setSession] = useState<Session>(() => {
    const saved = editorMemory.session;
    // A starter edited before the agent answered gives way to the agent's new surface.
    const stale = !saved || (saved.source === AGENT ? !agentText : agentKey !== null && agentKey !== saved.agentKey);
    if (saved && !stale) return saved;
    const source = agentText ? AGENT : list[0].id;
    const text = originalOf(source) ?? "";
    return { source, base: text, text, agentKey };
  });
  const { source, base, text } = session;
  useEffect(() => {
    editorMemory.session = session;
  }, [session]);

  // The agent's surface moved on (another surface selected, or the same one updated): follow it unless the text has edits.
  const agentMoved = source === AGENT && agentText !== null && agentText !== base;
  const dirty = text !== base;
  useEffect(() => {
    if (agentMoved && !dirty && agentText !== null) setSession({ source: AGENT, base: agentText, text: agentText, agentKey });
  }, [agentMoved, dirty, agentText, agentKey]);

  const manifest = useMemo(() => manifestOf(playgroundUI, [standardUI.id]), []);
  const analyze = useCallback((t: string) => analyzeOps(t, playgroundUI, manifest), [manifest]);
  const [checked, setChecked] = useState<{ analysis: Analysis; good: Good | null }>(() => {
    const analysis = analyze(text);
    return { analysis, good: analysis.ops ? { ops: analysis.ops, fingerprint: analysis.fingerprint!, surfaceId: analysis.surfaceId, version: 0 } : null };
  });
  useEffect(() => {
    const t = setTimeout(() => {
      const analysis = analyze(text);
      setChecked((prev) => ({
        analysis,
        // A new version only for a real change: whitespace edits keep the preview as it is.
        good: analysis.ops && analysis.fingerprint !== prev.good?.fingerprint ? { ops: analysis.ops, fingerprint: analysis.fingerprint!, surfaceId: analysis.surfaceId, version: (prev.good?.version ?? 0) + 1 } : prev.good,
      }));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, analyze]);
  const { analysis, good } = checked;
  const errors = analysis.problems.filter((p) => p.severity === "error");
  const warnings = analysis.problems.filter((p) => p.severity === "warning");
  const stale = errors.length > 0;

  const ta = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const [caret, setCaret] = useState(0);
  const pos = lineColOf(text, caret);
  const firstError = errors.find((p) => p.offset !== undefined);
  const errorLine = firstError ? lineColOf(text, firstError.offset!).line : null;

  const setText = (next: string) => setSession((s) => ({ ...s, text: next }));
  const load = (nextSource: string) => {
    const t = originalOf(nextSource) ?? "";
    setSession({ source: nextSource, base: t, text: t, agentKey });
    setCaret(0);
    if (ta.current) ta.current.scrollTop = 0;
  };
  const jumpTo = (offset: number) => {
    const el = ta.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(offset, offset);
    setCaret(offset);
    const { line } = lineColOf(text, offset);
    const y = PAD_PX + (line - 1) * LINE_PX;
    if (y < el.scrollTop || y > el.scrollTop + el.clientHeight - LINE_PX * 2) el.scrollTop = Math.max(0, y - el.clientHeight / 3);
  };

  const [copied, setCopied] = useState(false);
  const copy = () => {
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${analysis.surfaceId ?? good?.surfaceId ?? "surface"}.a2ui.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="pg-jed flex h-full min-h-0 flex-col" data-json-editor>
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-[var(--pg-line)] px-4 py-2.5">
        <EditToggle
          pressed
          onClick={() => {
            // Unedited text is not worth keeping: next time the editor opens on the newest surface.
            if (!dirty) editorMemory.session = null;
            onExit();
          }}
        />
        <div className="relative min-w-[140px] max-w-[230px] flex-1">
          <select
            aria-label="Operations to edit"
            value={source}
            onChange={(e) => load(e.target.value)}
            data-json-source
            className="h-7 w-full cursor-pointer appearance-none truncate rounded-md border border-[var(--pg-line)] bg-transparent pl-2 pr-6 text-[12px] text-foreground/90 outline-none transition-colors hover:border-[var(--pg-line-strong)] focus-visible:border-[var(--pg-line-strong)]"
          >
            {surface ? <option value={AGENT}>Agent: {surface.surfaceId}</option> : null}
            <optgroup label="Starters">
              {list.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </optgroup>
          </select>
          <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
        </div>
        <div className="ml-auto flex flex-none gap-1">
          <button type="button" onClick={() => load(source)} disabled={!dirty && !agentMoved} title={source === AGENT ? "Back to the agent's operations" : "Back to the starter"} className={headerButton} data-json-reset>
            <RotateCcw className="size-3" />
            Reset
          </button>
          <button type="button" onClick={copy} className={headerButton}>
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={exportFile} className={headerButton}>
            Export
          </button>
          <button type="button" onClick={() => onWide(!wide)} aria-label={wide ? "Narrow the inspector" : "Widen the inspector"} title={wide ? "Narrow the inspector" : "Widen the inspector"} className={cn(headerButton, "w-7 justify-center px-0")}>
            {wide ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
          </button>
        </div>
      </div>

      {agentMoved && dirty ? (
        <div className="flex flex-none items-center gap-2 border-b border-[var(--pg-line)] bg-[var(--pg-panel)] px-4 py-2 text-[12px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">The agent&apos;s surface changed since you started editing.</span>
          <button type="button" onClick={() => load(AGENT)} className={headerButton}>
            Load latest
          </button>
        </div>
      ) : null}

      <div className="pg-jed-split min-h-0 flex-1">
        <div className="pg-jed-left flex min-h-0 flex-col">
          <CodeEditor value={text} onChange={setText} taRef={ta} errorLine={errorLine} onCaret={setCaret} describedBy={hintId} />
          <div className="flex h-7 flex-none items-center gap-3 border-t border-[var(--pg-line)] bg-[var(--pg-surface)] px-3 font-mono text-[11px] text-[var(--pg-faint)]">
            <span className="flex-none whitespace-nowrap tabular-nums">
              Ln {pos.line}, Col {pos.col}
            </span>
            {dirty ? <span className="text-muted-foreground">edited</span> : null}
            <span id={hintId} className="pg-jed-hint min-w-0 truncate">
              Tab indents · Esc then Tab leaves the editor
            </span>
            <span className="ml-auto flex flex-none items-center gap-1.5 whitespace-nowrap" data-json-status={errors.length ? "error" : "ok"}>
              {errors.length ? (
                <>
                  <CircleAlert className="size-3 text-[var(--pg-jed-error)]" />
                  <span className="text-[var(--pg-jed-error)]">
                    {errors.length} {errors.length === 1 ? "problem" : "problems"}
                  </span>
                </>
              ) : (
                <>
                  <CircleCheck className="size-3 text-[var(--pg-fixed)]" />
                  <span className="text-muted-foreground">
                    Valid · {analysis.opCount} {analysis.opCount === 1 ? "op" : "ops"} · {analysis.componentCount} components
                    {warnings.length ? ` · ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}` : ""}
                  </span>
                </>
              )}
            </span>
          </div>
          {analysis.problems.length ? <ProblemList problems={analysis.problems} text={text} onJump={jumpTo} /> : null}
        </div>

        <div className="pg-jed-right flex min-h-0 flex-col border-t border-[var(--pg-line)]">
          <div className="flex h-9 flex-none items-center gap-2 border-b border-[var(--pg-line)] px-4 text-[12px]">
            <span className="font-medium text-foreground/90">Preview</span>
            {good?.surfaceId ? <span className="truncate font-mono text-[11px] text-[var(--pg-faint)]">{good.surfaceId}</span> : null}
            <span className="ml-auto flex flex-none items-center gap-1.5 font-mono text-[11px]" data-json-preview-state={stale ? "stale" : "live"}>
              {stale && good ? (
                <>
                  <span className="size-1.5 rounded-full bg-[var(--pg-dynamic)]" />
                  <span className="text-[var(--pg-dynamic)]">Last valid version</span>
                </>
              ) : good ? (
                <>
                  <span className="size-1.5 rounded-full bg-[var(--pg-fixed)]" />
                  <span className="text-muted-foreground">Live, no model</span>
                </>
              ) : null}
            </span>
          </div>
          <div className={cn("pg-jed-preview pg-dots min-h-0 flex-1 overflow-auto p-4 transition-opacity", stale && good && "pg-jed-preview-stale")} data-json-preview>
            {good ? (
              <StaticGenUIProvider>
                <PreviewBoundary key={good.version}>
                  <StaticSurface ops={good.ops} />
                </PreviewBoundary>
              </StaticGenUIProvider>
            ) : (
              <p className="p-1 text-[13px] text-muted-foreground">Fix the problems on the left to see the preview.</p>
            )}
          </div>
        </div>
      </div>

      <AskModel
        ops={stale ? null : (good?.ops ?? null)}
        onSent={() => {
          // The edited surface now lives in the chat: next time the editor opens on it.
          editorMemory.session = null;
          onExit();
        }}
      />
    </div>
  );
}

function ProblemList({ problems, text, onJump }: { problems: Problem[]; text: string; onJump: (offset: number) => void }) {
  return (
    <ul className="pg-jed-problems max-h-[148px] flex-none overflow-auto border-t border-[var(--pg-line)] bg-[var(--pg-surface)] py-1" aria-label="Problems" data-json-problems>
      {problems.map((p, i) => {
        const where = p.where === "json" ? "JSON" : p.where === "surface" ? "Surface" : `Op ${p.where}`;
        const loc = p.offset !== undefined ? lineColOf(text, p.offset) : null;
        const Icon = p.severity === "error" ? CircleAlert : TriangleAlert;
        return (
          <li key={i}>
            <button
              type="button"
              disabled={p.offset === undefined}
              onClick={() => p.offset !== undefined && onJump(p.offset)}
              className="grid w-full grid-cols-[14px_minmax(0,1fr)] gap-x-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--pg-panel)]"
              data-severity={p.severity}
            >
              <Icon className={cn("mt-[3px] size-3", p.severity === "error" ? "text-[var(--pg-jed-error)]" : "text-[var(--pg-dynamic)]")} />
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-mono text-[11px] text-[var(--pg-faint)]">
                <span className="text-muted-foreground">{where}</span>
                {p.opKind ? <span>{p.opKind}</span> : null}
                {p.componentId ? <span className="text-[oklch(0.86_0.1_165)]">#{p.componentId}</span> : null}
                {loc ? (
                  <span className="ml-auto tabular-nums">
                    Ln {loc.line}
                    {p.where === "json" ? `, Col ${loc.col}` : ""}
                  </span>
                ) : null}
              </span>
              <span className="col-start-2 text-[12px] leading-[1.45] text-foreground/85" data-json-problem-message>
                {p.message}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** A render error in the preview stays in the preview. The next valid edit remounts it. */
class PreviewBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <p className="p-1 text-[13px] text-[var(--pg-jed-error)]">The preview could not render this: {this.state.error.message}</p>;
  }
}

/**
 * A plain textarea with the JSON coloured underneath it (the textarea text
 * is transparent, the caret and the selection are not), line numbers and a
 * band on the line of the first error. No wrapping, so lines map 1:1.
 */
function CodeEditor({
  value,
  onChange,
  taRef,
  errorLine,
  onCaret,
  describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  taRef: RefObject<HTMLTextAreaElement | null>;
  errorLine: number | null;
  onCaret: (offset: number) => void;
  describedBy?: string;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const escaped = useRef(false);
  const html = useMemo(() => highlightJson(value) + "\n", [value]);
  const lines = useMemo(() => {
    let n = 1;
    for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) === 10) n++;
    return n;
  }, [value]);
  const numbers = useMemo(() => Array.from({ length: lines }, (_, i) => i + 1).join("\n"), [lines]);

  const sync = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    if (layer.current) layer.current.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
    if (gutter.current) gutter.current.style.transform = `translateY(${-el.scrollTop}px)`;
  }, [taRef]);
  useLayoutEffect(sync);

  // The problem list opening under the editor shrinks it: keep the line being typed on in view.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    let height = el.clientHeight;
    const ro = new ResizeObserver(() => {
      const next = el.clientHeight;
      if (next < height && document.activeElement === el) {
        const line = el.value.slice(0, el.selectionStart).split("\n").length;
        const bottom = PAD_PX + line * LINE_PX;
        if (bottom > el.scrollTop + next) el.scrollTop = bottom + LINE_PX - next;
      }
      height = next;
      sync();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [taRef, sync]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    if (e.key === "Escape") {
      escaped.current = true;
      return;
    }
    if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Esc then Tab moves focus on, so the editor is not a keyboard trap.
      if (escaped.current) {
        escaped.current = false;
        return;
      }
      e.preventDefault();
      indent(el, e.shiftKey);
      return;
    }
    escaped.current = false;
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      newline(el);
    }
  };

  return (
    <div className="pg-jed-code relative flex min-h-0 flex-1 overflow-hidden bg-[var(--pg-bg)]">
      <div className="pg-jed-gutter relative w-11 flex-none overflow-hidden border-r border-[var(--pg-line)]" aria-hidden>
        <div ref={gutter} className="absolute inset-x-0 top-0">
          {errorLine ? <div className="pg-jed-gutter-error absolute inset-x-0" style={{ top: PAD_PX + (errorLine - 1) * LINE_PX, height: LINE_PX }} /> : null}
          <pre className="pg-jed-lines">{numbers}</pre>
        </div>
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div ref={layer} className="pointer-events-none absolute left-0 top-0 min-w-full" aria-hidden>
          {errorLine ? <div className="pg-jed-error-band absolute inset-x-0" style={{ top: PAD_PX + (errorLine - 1) * LINE_PX, height: LINE_PX }} /> : null}
          <pre className="pg-json pg-jed-text" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            onCaret(e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onSelect={(e) => onCaret(e.currentTarget.selectionStart)}
          onScroll={sync}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          aria-label="A2UI operations, JSON"
          aria-describedby={describedBy}
          data-json-input
          className="pg-jed-text pg-jed-input absolute inset-0 h-full w-full"
        />
      </div>
    </div>
  );
}

/** The Clipboard API, else the old copy command (it works where the API is not allowed). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  const tmp = document.createElement("textarea");
  tmp.value = text;
  tmp.setAttribute("readonly", "");
  tmp.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(tmp);
  tmp.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {}
  tmp.remove();
  return ok;
}

/** Replaces the selection with `text` through the browser, so undo and redo keep working. */
function insert(el: HTMLTextAreaElement, text: string) {
  el.focus();
  let done = false;
  try {
    done = document.execCommand("insertText", false, text);
  } catch {}
  if (!done) {
    el.setRangeText(text, el.selectionStart, el.selectionEnd, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/** Tab: two spaces at the caret, or indent every selected line. Shift+Tab: outdent. */
function indent(el: HTMLTextAreaElement, outdent: boolean) {
  const { value, selectionStart: start, selectionEnd: end } = el;
  if (!outdent && start === end) return insert(el, "  ");
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nl = value.indexOf("\n", last);
  const lineEnd = nl < 0 ? value.length : nl;
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const next = lines.map((l) => (outdent ? l.replace(/^ {1,2}/, "") : `  ${l}`));
  const nextBlock = next.join("\n");
  if (nextBlock === block) return;
  el.setSelectionRange(lineStart, lineEnd);
  insert(el, nextBlock);
  if (start === end) {
    const caret = Math.max(lineStart, start - (lines[0].length - next[0].length));
    el.setSelectionRange(caret, caret);
  } else el.setSelectionRange(lineStart, lineStart + nextBlock.length);
}

/** Enter keeps the indent of the line, adds a level after { or [, and puts a closing bracket right after the caret on its own line. */
function newline(el: HTMLTextAreaElement) {
  const { value, selectionStart: start, selectionEnd: end } = el;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const before = value.slice(lineStart, start);
  const pad = /^[ \t]*/.exec(before)![0];
  const opener = before.trimEnd().slice(-1);
  const closer = /^[ \t]*(\S)?/.exec(value.slice(end))?.[1];
  const opens = opener === "{" || opener === "[";
  if (opens && closer === (opener === "{" ? "}" : "]")) {
    insert(el, `\n${pad}  \n${pad}`);
    const caret = start + 1 + pad.length + 2;
    el.setSelectionRange(caret, caret);
    return;
  }
  insert(el, `\n${pad}${opens ? "  " : ""}`);
}
