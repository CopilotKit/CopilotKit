"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { PanelRightOpen } from "lucide-react";
import { AgentTap } from "@/components/app/agent-tap";
import { useMode } from "@/components/app/providers";
import { modelLabel } from "@/lib/model-options";
import { runStore, useRunStore } from "@/lib/run-store";
import { cn } from "@/lib/utils";
import { Composer, focusRing } from "./composer";
import { editorMemory } from "./json-editor";
import { LinkContext, useLinkState, useShownLines } from "./lines";
import { LinesBeside, Thread, useAgentPulse } from "./thread";
import type { OnSelect, Selection } from "./thread";
import { isHandEdited, runOf, surfaceOfTurn, useTurns } from "./turns";
import { WritesPane } from "./writes-pane";
import type { WritesTab } from "./writes-pane";
import "./compact.css";

const NARROW = "(max-width: 899px)";
const subscribeNarrow = (fn: () => void) => {
  const mq = matchMedia(NARROW);
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
};
/** Under 900px: one column, the conversation, with the lines opening over it. */
const useNarrow = () =>
  useSyncExternalStore(
    subscribeNarrow,
    () => matchMedia(NARROW).matches,
    () => false,
  );

/** The visitor's choice of side panel, kept for the next visit (not in an embed, which always starts collapsed). */
const PANE_KEY = "a2ui-writes-pane";
type Pane = "open" | "collapsed";

/**
 * The front door: the conversation first, each generated UI inline under the prompt that asked for it,
 * and beside it the lines the model wrote for the selected surface, linked both ways. The side panel
 * collapses to a rail. On a phone the conversation is the whole screen and the lines open from the chip
 * under a surface.
 *
 * `embed` (`?embed=1`, an iframe on CopilotKit's site or docs): the panel starts collapsed, so a small
 * frame shows the conversation and its UI, and the choice is not remembered.
 */
export function Workbench({ embed = false }: { embed?: boolean }) {
  const turns = useTurns();
  const { model } = useMode();
  const narrow = useNarrow();
  // Agent events for the surfaces, heard from before the first run: the thread mounts only once one starts.
  useAgentPulse();

  // The selected surface: the newest, unless one was clicked in the conversation.
  const [picked, setPicked] = useState<string | null>(null);
  const lastId = turns[turns.length - 1]?.id;
  useEffect(() => setPicked(null), [lastId]);
  const turn = turns.find((t) => t.id === picked) ?? turns[turns.length - 1];
  const run = useRunStore((s) => runOf(turn, s.runs));
  const surfaceKey = surfaceOfTurn(turn, run);
  const surfaceOps =
    useRunStore((s) =>
      surfaceKey ? s.surfaces[surfaceKey]?.ops : undefined,
    ) ?? null;

  const shown = useShownLines({
    run,
    ops: surfaceOps,
    handEdited: !!turn && isHandEdited(turn),
  });

  // The JSON tab shows the selected surface.
  useEffect(() => {
    if (surfaceKey) runStore.select(surfaceKey);
  }, [surfaceKey]);

  // The line <-> component link starts over with each surface.
  const link = useLinkState();
  const { setHover, togglePin, pinned } = link;
  const linkScope = surfaceKey ?? turn?.id ?? "";
  useEffect(() => {
    setHover(null);
    if (pinned) togglePin(pinned);
    // Only when the surface on screen changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkScope]);

  const selection = useMemo<Selection>(
    () => ({
      key: surfaceKey,
      count: shown.lines.filter((l) => l.kind === "line").length,
      format: shown.format,
      lineOf: shown.lineOf,
      ops: surfaceOps,
    }),
    [surfaceKey, shown, surfaceOps],
  );

  const [tab, setTab] = useState<WritesTab>("lines");

  // 900px and up: the side panel, open or collapsed to a rail. Unknown (null) until the stored choice is
  // read, before the first paint; an embed knows from the server render.
  const [pane, setPane] = useState<Pane | null>(embed ? "collapsed" : null);
  useLayoutEffect(() => {
    if (embed) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(PANE_KEY);
    } catch {
      // Storage blocked: the panel starts open.
    }
    setPane(stored === "collapsed" ? "collapsed" : "open");
  }, [embed]);
  const collapsed = pane === "collapsed";
  // The first prompt of an empty chat opens the side panel (beside the conversation, not over it on a phone),
  // so the A2UI can be watched streaming in. It does not overwrite the stored choice.
  const hadTurns = useRef(turns.length > 0);
  useEffect(() => {
    if (!turns.length) {
      hadTurns.current = false;
      return;
    }
    if (hadTurns.current) return;
    hadTurns.current = true;
    if (!embed && !matchMedia(NARROW).matches) setPane("open");
  }, [turns.length, embed]);
  const setCollapsed = useCallback(
    (next: boolean) => {
      setPane(next ? "collapsed" : "open");
      if (embed) return;
      try {
        localStorage.setItem(PANE_KEY, next ? "collapsed" : "open");
      } catch {
        // Storage blocked (a private window, a sandboxed frame): the choice lasts until the page reloads.
      }
    },
    [embed],
  );
  // Focus follows the control: collapsing lands on the rail that brings the panel back, and the rail lands
  // on the panel's collapse button.
  const rail = useRef<HTMLButtonElement>(null);
  const collapseBtn = useRef<HTMLButtonElement>(null);
  const collapse = () => {
    setCollapsed(true);
    requestAnimationFrame(() => rail.current?.focus());
  };
  const expand = () => {
    setCollapsed(false);
    requestAnimationFrame(() => collapseBtn.current?.focus());
  };

  // Phones: the lines open over the conversation, and focus goes back to where it came from. Beside the
  // conversation, asking for the lines (the chip under a surface) opens a collapsed panel.
  const [codeOpen, setCodeOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const back = useRef<HTMLButtonElement>(null);
  const openCode = useCallback(() => {
    if (!matchMedia(NARROW).matches) {
      setCollapsed(false);
      return;
    }
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setCodeOpen(true);
    requestAnimationFrame(() => back.current?.focus());
  }, [setCollapsed]);
  const closeCode = useCallback(() => {
    setCodeOpen(false);
    const from = opener.current;
    opener.current = null;
    // The opener can be gone (an item of the "+" menu): then the "+", or the prompt in a frame too small for it.
    const to = [
      from,
      document.querySelector<HTMLElement>("[data-wb-plus]"),
      document.getElementById("wb-prompt"),
    ].find((el) => el?.isConnected && el.getClientRects().length > 0);
    if (to) requestAnimationFrame(() => to.focus());
  }, []);
  useEffect(() => {
    if (!narrow) setCodeOpen(false);
  }, [narrow]);

  const onSelect = useCallback<OnSelect>(
    (turnId, open) => {
      setPicked(turnId);
      if (open) openCode();
    },
    [openCode],
  );

  // Editing by hand: the JSON tab's editor, a mode of the panel's own. It opens wide (unless the visitor
  // narrowed it this visit), and Done goes back to the tab it came from.
  const [jsonKey, setJsonKey] = useState(0);
  const [jsonWide, setJsonWide] = useState(false);
  const [editing, setEditingState] = useState(() => editorMemory.editing);
  const hand = tab === "json" && editing;
  const handFrom = useRef<WritesTab>("lines");
  const keptNarrow = useRef(false);
  const setEditing = (on: boolean) => {
    if (on && !hand) handFrom.current = tab;
    editorMemory.editing = on;
    setEditingState(on);
    setJsonWide(on && !keptNarrow.current);
  };
  const onJsonWide = (next: boolean) => {
    keptNarrow.current = !next;
    setJsonWide(next);
  };
  const doneEditing = () => {
    const to = handFrom.current;
    setEditing(false);
    setTab(to);
    requestAnimationFrame(() =>
      document.getElementById(`wb-tab-${to}`)?.focus(),
    );
  };

  // "Start without AI": straight into the editor (a starter, no model).
  const startWithoutAI = () => {
    editorMemory.focus = !matchMedia("(pointer: coarse)").matches;
    setEditing(true);
    setTab("json");
    setJsonKey((k) => k + 1);
    openCode();
  };

  // A prompt went out: its answer is the selected surface, in the conversation.
  const onSent = useCallback(() => {
    setPicked(null);
    setCodeOpen(false);
  }, []);

  // The JSON editor's "Ask the model to change this" sends the request: show the conversation it lands in.
  useEffect(() => {
    const show = () => onSent();
    window.addEventListener("a2ui:show-chat", show);
    return () => window.removeEventListener("a2ui:show-chat", show);
  }, [onSent]);

  const writer = modelLabel(run?.model ?? model);
  // Present tense while the lines stream in, past tense once the run is over.
  const writing = !run || run.status === "running";
  // A template drew the surface (its lines are decompiled), so no model wrote them; by hand, nobody did.
  const title = hand
    ? "Editing by hand"
    : run?.path === "fixed"
      ? "From a template"
      : `${writer} ${writing ? "writes" : "wrote"}`;
  // The tab is named for what it shows: an Express run that fell back to JSON ends in JSON lines.
  const linesLabel = shown.format === "json" ? "JSON stream" : "Express";
  const wide = jsonWide && hand;
  const covered = narrow && codeOpen;
  const lineCount = hand ? 0 : selection.count;
  // An empty chat is a landing: the heading, starter prompts and the prompt box, centered on their own. The
  // conversation and the side panel take over with the first prompt (or "start without AI").
  const landing = !turns.length && !hand && !codeOpen;

  return (
    <LinkContext.Provider value={link}>
      <LinesBeside.Provider value={!narrow && !collapsed}>
        <AgentTap />
        <main
          id="main"
          data-pane={pane ?? undefined}
          data-landing={landing || undefined}
          className={cn(
            "wb wb-main relative grid min-h-0 flex-1 grid-cols-1 overflow-hidden",
            // Wide, the editor and its preview sit side by side from about 1280px.
            wide
              ? "min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
              : "min-[900px]:grid-cols-[minmax(0,1fr)_380px] min-[1280px]:grid-cols-[minmax(0,1fr)_460px]",
          )}
        >
          <section
            aria-label="Conversation"
            inert={covered || undefined}
            aria-hidden={covered || undefined}
            className={cn(
              "flex min-h-0 flex-col",
              !landing &&
                "min-[900px]:border-r min-[900px]:border-[var(--pg-line)]",
            )}
          >
            {landing ? (
              <div className="wb-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
                <div className="my-auto py-12 max-[899px]:py-8" data-wb-landing>
                  <header className="mx-auto max-w-[680px] px-6 text-center max-[899px]:px-4">
                    <h1 className="wb-rise text-balance text-[32px] font-semibold leading-[1.08] tracking-[-0.025em] max-[899px]:text-[26px]">
                      Watch an&nbsp;agent write&nbsp;UI.
                    </h1>
                    <p
                      style={{ "--rise": 1 } as React.CSSProperties}
                      className="wb-rise mx-auto mt-3 max-w-[48ch] text-balance text-[15px] leading-[1.55] text-[var(--pg-dim)]"
                    >
                      Ask for a UI. The model writes A2UI, Google&apos;s open
                      protocol, and your design system draws it.
                    </p>
                  </header>
                  <Composer
                    landing
                    empty
                    onSent={onSent}
                    onStartWithoutAI={startWithoutAI}
                  />
                </div>
              </div>
            ) : (
              <>
                <Thread
                  turns={turns}
                  selection={selection}
                  onSelect={onSelect}
                />
                <Composer
                  empty={!turns.length}
                  noAILine={!hand}
                  onSent={onSent}
                  onStartWithoutAI={startWithoutAI}
                />
              </>
            )}
          </section>

          {landing ? null : (
            <>
              <WritesPane
                ref={back}
                title={title}
                linesLabel={linesLabel}
                shown={shown}
                tab={tab}
                onTab={setTab}
                runId={run ? run.id : turn ? null : undefined}
                jsonKey={jsonKey}
                jsonWide={jsonWide}
                onJsonWide={onJsonWide}
                editing={editing}
                onEditing={setEditing}
                onDone={doneEditing}
                onBack={closeCode}
                onCollapse={collapse}
                collapseRef={collapseBtn}
                className={cn(
                  "bg-[var(--pg-bg)] max-[899px]:absolute max-[899px]:inset-0 max-[899px]:z-30",
                  codeOpen ? "wb-sheet" : "max-[899px]:hidden",
                )}
              />

              {/* The collapsed panel: a rail at the window's edge, the whole of it a button that opens it again. */}
              <button
                ref={rail}
                type="button"
                onClick={expand}
                aria-expanded={false}
                aria-controls="wb-writes-pane"
                title="Expand panel"
                data-wb-rail
                // The ring sits inside the rail: outside it, the window's edge would cut it off.
                className={cn(
                  focusRing,
                  "wb-rail group min-h-0 flex-col items-center gap-3 bg-[var(--pg-bg)] pt-2.5 text-[var(--pg-dim)] transition-colors hover:bg-[oklch(var(--ink)/3%)] hover:text-foreground focus-visible:-outline-offset-2",
                )}
              >
                <span className="flex size-8 flex-none items-center justify-center rounded-md transition-colors group-hover:bg-[oklch(var(--ink)/5%)]">
                  <PanelRightOpen className="size-4" aria-hidden />
                </span>
                <span className="wb-rail-label text-[13px] font-medium">
                  <span className="sr-only">Expand panel: </span>
                  {title}
                  {lineCount ? (
                    <span className="font-mono text-[12px] font-normal">
                      {` · ${lineCount} ${lineCount === 1 ? "line" : "lines"}`}
                    </span>
                  ) : null}
                </span>
              </button>
            </>
          )}
        </main>
      </LinesBeside.Provider>
    </LinkContext.Provider>
  );
}
