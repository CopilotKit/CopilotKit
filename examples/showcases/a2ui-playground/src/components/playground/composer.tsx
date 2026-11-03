"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { DropdownMenu } from "radix-ui";
import {
  ArrowUp,
  Braces,
  Check,
  ChevronLeft,
  ChevronRight,
  CodeXml,
  Cpu,
  Lightbulb,
  Plus,
  Square,
  SquarePen,
  SwatchBook,
} from "lucide-react";
import { forgetChat } from "@/components/app/agent-tap";
import { useMode, type Mode } from "@/components/app/providers";
import { useSend } from "@/components/app/use-send";
import { useDesignSystem } from "@/design-systems/context";
import {
  DESIGN_SYSTEMS,
  designSystemLabel,
  type DesignSystemId,
} from "@/design-systems/registry";
import {
  FORMAT_OPTIONS,
  modelLabel,
  type Format,
  type ModelId,
} from "@/lib/model-options";
import { runStore } from "@/lib/run-store";
import { cn } from "@/lib/utils";
import type { Replay } from "./replay";

type Tag = "macro" | "template";

/** Macros always compose (they expand on the server), whatever the router would pick. Flights is a ready-made template. */
const SUGGESTIONS: Array<{ text: string; tag?: Tag }> = [
  { text: "Q3 sales by region as a dashboard" },
  { text: "Compare three noise-cancelling headphones", tag: "macro" },
  { text: "Live weather report for Lisbon", tag: "macro" },
  { text: "Plan a 3-day Tokyo trip with a map" },
  { text: "Flights from SFO to JFK on Friday", tag: "template" },
];

export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wb-violet-ring)]";

/**
 * A short window or a small square (an iframe on CopilotKit's site, a landscape phone): the chrome around the
 * answer shrinks. The same query is in compact.css, which does the shrinking; this is for what CSS cannot change.
 */
export const COMPACT =
  "(max-height: 700px), (max-width: 899px) and (max-height: 860px) and (min-aspect-ratio: 3/4)";
function mediaStore(query: string) {
  return {
    subscribe: (fn: () => void) => {
      const mq = matchMedia(query);
      mq.addEventListener("change", fn);
      return () => mq.removeEventListener("change", fn);
    },
    matches: () => matchMedia(query).matches,
  };
}
const compactStore = mediaStore(COMPACT);
export const useCompact = () =>
  useSyncExternalStore(
    compactStore.subscribe,
    compactStore.matches,
    () => false,
  );
/** A phone held upright, where the long placeholder would wrap to a second line. */
const narrowStore = mediaStore("(max-width: 639px)");
const useNarrow = () =>
  useSyncExternalStore(narrowStore.subscribe, narrowStore.matches, () => false);

/**
 * Keeps a wrapping list to its first two rows: items that would start a third are hidden (and so leave the
 * tab order), measured again whenever the list changes width.
 */
function useTwoRows(ref: React.RefObject<HTMLElement | null>, on: boolean) {
  useLayoutEffect(() => {
    const list = ref.current;
    if (!on || !list) return;
    const fit = () => {
      const items = Array.from(list.children) as HTMLElement[];
      items.forEach((li) => (li.hidden = false));
      // Compact: one row that scrolls sideways (compact.css), so every prompt stays.
      if (getComputedStyle(list).flexWrap === "nowrap") return;
      const rows = [...new Set(items.map((li) => li.offsetTop))].sort(
        (a, b) => a - b,
      );
      const last = rows[Math.min(1, rows.length - 1)];
      items.forEach((li) => (li.hidden = li.offsetTop > last));
    };
    fit();
    // The web font can land after the first fit and change every item's width.
    let live = true;
    void document.fonts?.ready.then(() => live && fit());
    let width = list.clientWidth;
    const ro = new ResizeObserver(() => {
      if (list.clientWidth === width) return;
      width = list.clientWidth;
      fit();
    });
    ro.observe(list);
    // The list switches between two wrapping rows and one scrolling row without changing width.
    const mq = matchMedia(COMPACT);
    mq.addEventListener("change", fit);
    return () => {
      live = false;
      ro.disconnect();
      mq.removeEventListener("change", fit);
    };
  }, [ref, on]);
}

/** A swatch per design system, so the picker shows at a glance which one draws the surfaces. */
const SWATCH: Record<DesignSystemId, string> = {
  copilotkit: "bg-[oklch(0.6_0.19_292)] dark:bg-[oklch(0.72_0.17_292)]",
  // shadcn's primary: near-black on light, near-white on dark.
  chatcn: "bg-[oklch(0.205_0_0)] dark:bg-[oklch(0.922_0_0)]",
  // Material's primary, in Material's own shape: the only round swatch.
  material: "rounded-full bg-[#495d92] dark:bg-[#b2c5ff]",
  byoc: "bg-[#0b5cff]",
};

const menu =
  "z-50 min-w-[16rem] max-w-[calc(100vw-2rem)] rounded-xl border outline-none border-[var(--pg-line)] bg-popover p-1 text-popover-foreground shadow-[0_12px_32px_-12px_var(--pg-shadow)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[side=top]:slide-in-from-bottom-1 data-[side=right]:slide-in-from-left-1";
const menuItem =
  "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] leading-snug outline-none select-none data-[highlighted]:bg-[oklch(var(--ink)/5%)] data-[state=open]:bg-[oklch(var(--ink)/5%)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4 [&>svg]:flex-none [&>svg]:text-[var(--pg-dim)]";

const rule = "mx-1 my-1 h-px bg-[var(--pg-line)]";

/** The lists the "+" menu opens. */
type List = "design-system" | "model" | "format" | "prompts";
const LIST_TITLE: Record<List, string> = {
  "design-system": "Design system",
  model: "Model",
  format: "Format",
  prompts: "Try a prompt",
};

/**
 * An entry in the "+" menu that opens a list: what it sets, the current choice on the right, and the list in a
 * submenu beside the menu. On a phone, where a submenu would run off the screen, the list takes the menu's place.
 */
function Opens({
  list,
  icon,
  value,
  inPlace,
  onOpen,
  portal,
  children,
}: {
  list: List;
  icon: ReactNode;
  value?: ReactNode;
  inPlace: boolean;
  onOpen: (list: List) => void;
  portal: HTMLElement | null;
  children: ReactNode;
}) {
  const row = (
    <>
      {icon}
      {LIST_TITLE[list]}
      {value ? (
        <span className="ml-auto flex items-center gap-1.5 pl-4 text-[12.5px] text-[var(--pg-dim)]">
          {value}
        </span>
      ) : null}
      <ChevronRight className={value ? "-ml-1" : "ml-auto"} aria-hidden />
    </>
  );
  if (inPlace)
    return (
      <DropdownMenu.Item
        data-opens={list}
        onSelect={(e) => {
          e.preventDefault();
          onOpen(list);
        }}
        className={menuItem}
      >
        {row}
      </DropdownMenu.Item>
    );
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger data-opens={list} className={menuItem}>
        {row}
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal container={portal}>
        <DropdownMenu.SubContent
          sideOffset={6}
          className={cn(menu, "w-[19rem]")}
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

/** A choice in a picker's submenu: its name and note, a line on what it does, and a check when it is the current one. */
function Choice({
  label,
  note,
  hint,
}: {
  label: string;
  note?: string;
  hint?: string;
}) {
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span>
          {label}
          {note ? <span className="text-[var(--pg-dim)]"> {note}</span> : null}
        </span>
        {hint ? (
          <span className="text-[11.5px] leading-snug text-[var(--pg-dim)]">
            {hint}
          </span>
        ) : null}
      </span>
      <DropdownMenu.ItemIndicator className="mt-0.5 flex-none">
        <Check className="size-4" aria-hidden />
      </DropdownMenu.ItemIndicator>
    </>
  );
}
const choice = cn(menuItem, "items-start");

/** The mono tag on a starter prompt that does not go through the usual compose. */
function SuggestionTag({ tag }: { tag: Tag }) {
  return (
    <span
      className={cn(
        "flex-none font-mono text-[11px]",
        tag === "macro" ? "text-[var(--wb-amber)]" : "text-[var(--pg-fixed)]",
      )}
      title={
        tag === "macro"
          ? "One line from the model, expanded into standard components on the server"
          : "A ready-made layout: the model fills in data only"
      }
    >
      {tag}
    </span>
  );
}

/**
 * The composer, pinned under the conversation: a few prompts to start from (until the visitor has asked
 * something), the prompt box (a "+" menu, the prompt, Build or Stop), and until then, under it, the way in
 * without a model. The design system, model and format pickers are in the "+" menu.
 */
export function Composer({
  replay,
  empty,
  onSent,
  onStartWithoutAI,
}: {
  replay: Replay;
  empty: boolean;
  onSent: () => void;
  onStartWithoutAI: () => void;
}) {
  const { model, setModel, format, setFormat, models } = useMode();
  const designSystem = useDesignSystem();
  const { send, running } = useSend();
  const { agent } = useAgent({ agentId: "default", updates: [] });
  const { copilotkit } = useCopilotKit();
  const [text, setText] = useState("");
  const [queued, setQueued] = useState<{ text: string; mode?: Mode } | null>(
    null,
  );
  const box = useRef<HTMLTextAreaElement>(null);
  const chips = useRef<HTMLUListElement>(null);
  const noteId = useId();
  const compact = useCompact();
  const narrow = useNarrow();
  useTwoRows(chips, empty);
  // The "+" menu portals into the playground's root rather than <body>: its colours are scoped to `.pg-root`.
  const wrap = useRef<HTMLDivElement>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  // A choice, a new chat or a starter prompt hands the focus back to the prompt, not to the "+" that opened the menu.
  // Not on a touch screen, where the keyboard would come up over the answer.
  const toPrompt = useRef(false);
  const touched = useRef(false);
  useEffect(() => {
    setPortal(wrap.current?.closest<HTMLElement>(".pg-root") ?? null);
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  // On a phone, the list the menu shows in its own place; elsewhere lists open beside it.
  const [list, setList] = useState<List | null>(null);
  const shown = narrow ? list : null;
  const menuRef = useRef<HTMLDivElement>(null);
  const lastList = useRef<List | null>(null);
  // Whether the menu was last driven from the keyboard rather than a pointer.
  const keyed = useRef(false);
  // From the keyboard, into a list the focus goes to its first choice and back out to the entry that opened it.
  // From a pointer (a tap on a phone), to the menu itself, so no row lights up that was not touched.
  useEffect(() => {
    const content = menuRef.current;
    if (!menuOpen || !content) {
      lastList.current = null;
      return;
    }
    const back = lastList.current;
    lastList.current = shown;
    if (!shown && !back) return;
    const to = !keyed.current
      ? content
      : shown
        ? content.querySelector<HTMLElement>(
            '[role^="menuitem"]:not([data-menu-back]):not([data-disabled])',
          )
        : content.querySelector<HTMLElement>(`[data-opens="${back}"]`);
    to?.focus();
  }, [menuOpen, shown]);

  // The queued prompt goes out once the run it waited for has ended.
  useEffect(() => {
    if (running || !queued) return;
    setQueued(null);
    onSent();
    void send(queued.text, queued.mode ? { mode: queued.mode } : {});
  }, [running, queued, send, onSent]);

  const go = (prompt: string, mode?: Mode) => {
    const clean = prompt.trim();
    if (!clean) return;
    replay.dismiss();
    if (running) {
      setQueued({ text: clean, mode });
      return;
    }
    onSent();
    void send(clean, mode ? { mode } : {});
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) {
      box.current?.focus();
      return;
    }
    go(text);
    setText("");
  };

  const stop = () => {
    const cur = runStore.current();
    if (cur?.status === "running") runStore.endRun(cur.id, "stopped");
    const live = copilotkit.getAgent("default") ?? agent;
    if (live?.isRunning) copilotkit.stopAgent({ agent: live });
  };

  // Starts over: stops a run, empties the chat and its runs, forgets the saved session and skips the replay.
  // A fresh thread id keeps the runtime from bringing the old thread's events back.
  const newChat = () => {
    stop();
    setQueued(null);
    setText("");
    replay.dismiss();
    const live = copilotkit.getAgent("default") ?? agent;
    if (live) {
      live.setMessages([]);
      live.threadId = crypto.randomUUID();
    }
    runStore.reset();
    forgetChat();
    box.current?.focus();
  };
  const started =
    !empty || replay.status === "playing" || replay.status === "ended";

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  // What the "+" menu's entries open: the three pickers and the starter prompts.
  const lists: Record<List, ReactNode> = {
    "design-system": (
      <DropdownMenu.RadioGroup
        value={designSystem.id}
        onValueChange={(v) => {
          toPrompt.current = true;
          designSystem.setId(v as DesignSystemId);
        }}
      >
        {DESIGN_SYSTEMS.map((d) => (
          <DropdownMenu.RadioItem
            key={d.id}
            value={d.id}
            data-design-system={d.id}
            className={choice}
          >
            <span
              aria-hidden
              className={cn(
                "mt-[7px] size-2 flex-none rounded-[3px]",
                SWATCH[d.id],
              )}
            />
            <Choice label={d.label} note={d.note} hint={d.hint} />
          </DropdownMenu.RadioItem>
        ))}
      </DropdownMenu.RadioGroup>
    ),
    model: (
      <DropdownMenu.RadioGroup
        value={model}
        onValueChange={(v) => {
          toPrompt.current = true;
          setModel(v as ModelId);
        }}
      >
        {models.map((m) => (
          <DropdownMenu.RadioItem
            key={m.id}
            value={m.id}
            data-model={m.id}
            disabled={!m.available}
            className={choice}
          >
            <Choice
              label={m.label}
              note={m.note}
              hint={
                !m.available && m.reason
                  ? `Not available here. ${m.reason}`
                  : undefined
              }
            />
          </DropdownMenu.RadioItem>
        ))}
      </DropdownMenu.RadioGroup>
    ),
    format: (
      <DropdownMenu.RadioGroup
        value={format}
        onValueChange={(v) => {
          toPrompt.current = true;
          setFormat(v as Format);
        }}
      >
        {FORMAT_OPTIONS.map((f) => (
          <DropdownMenu.RadioItem
            key={f.id}
            value={f.id}
            data-format={f.id}
            className={choice}
          >
            <Choice label={f.label} hint={f.hint} />
          </DropdownMenu.RadioItem>
        ))}
      </DropdownMenu.RadioGroup>
    ),
    prompts: SUGGESTIONS.map((s) => (
      <DropdownMenu.Item
        key={s.text}
        onSelect={() => {
          toPrompt.current = true;
          go(s.text, s.tag === "macro" ? "dynamic" : undefined);
        }}
        className={menuItem}
      >
        <span className="min-w-0 flex-1">{s.text}</span>
        {s.tag ? <SuggestionTag tag={s.tag} /> : null}
      </DropdownMenu.Item>
    )),
  };

  // While the replay types its prompt, the box shows it; the visitor's own typing takes over at once.
  const ghost =
    replay.status === "playing" && !replay.sent ? replay.typed : null;

  return (
    <div
      ref={wrap}
      className="wb-composer relative flex-none pb-4 pt-2 max-[899px]:pb-3"
    >
      <div className="mx-auto w-full max-w-[844px] px-8 max-[1279px]:px-6 max-[899px]:px-4">
        {empty ? (
          <div className="mb-2.5" data-wb-chips-wrap>
            <h2 className="sr-only">Try one</h2>
            {/* At most two rows, so the conversation keeps its room: the prompts that would start a third are hidden.
                In a small frame, one row that scrolls sideways (compact.css). */}
            <ul ref={chips} className="flex flex-wrap gap-1.5" data-wb-chips>
              {SUGGESTIONS.map((s) => (
                <li key={s.text} className="min-w-0 max-w-full">
                  <button
                    type="button"
                    data-suggestion={s.text}
                    onClick={() =>
                      go(s.text, s.tag === "macro" ? "dynamic" : undefined)
                    }
                    className={cn(
                      "flex max-w-full items-center gap-2 rounded-[9px] border border-[var(--pg-line)] px-3 py-1.5 text-[13px] leading-snug text-[var(--pg-dim)] transition-colors hover:border-[var(--pg-line-strong)] hover:bg-[oklch(var(--ink)/3%)] dark:hover:bg-white/[0.025] hover:text-foreground max-[899px]:rounded-full",
                      focusRing,
                    )}
                  >
                    <span className="truncate">{s.text}</span>
                    {s.tag ? <SuggestionTag tag={s.tag} /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {queued ? (
          <div
            role="status"
            className="mb-2 flex items-center gap-3 text-[13px] text-[var(--pg-dim)]"
          >
            <span className="min-w-0 truncate">
              Next: <span className="text-foreground">{queued.text}</span>. It
              sends when this answer is done.
            </span>
            <button
              type="button"
              onClick={() => {
                setText(queued.text);
                setQueued(null);
              }}
              className={cn(
                "ml-auto flex-none rounded-md border border-[var(--pg-line)] px-2 py-0.5 text-[12px] transition-colors hover:text-foreground",
                focusRing,
              )}
            >
              Cancel
            </button>
          </div>
        ) : null}

        <form
          onSubmit={submit}
          aria-label="Ask for a UI"
          className="wb-prompt flex items-end gap-1 rounded-[14px] border border-[var(--pg-line-strong)] bg-[var(--pg-surface)] p-2 shadow-[0_10px_30px_-12px_var(--pg-shadow)] transition-[border-color,box-shadow] hover:border-[oklch(var(--ink)/22%)] dark:hover:border-[oklch(1_0_0/20%)] has-[textarea:focus-visible]:border-[var(--wb-violet)] has-[textarea:focus-visible]:shadow-[0_0_0_3px_var(--wb-violet-glow),0_10px_30px_-12px_var(--pg-shadow)]"
        >
          {/* Everything but the prompt: what draws, writes and formats the answer, writing JSON by hand, a starter
              prompt, a new chat. */}
          <DropdownMenu.Root
            open={menuOpen}
            onOpenChange={(open) => {
              setMenuOpen(open);
              // Each time it opens, the menu starts at its top level.
              if (open) setList(null);
            }}
          >
            <DropdownMenu.Trigger
              aria-label="Settings and more"
              title="Settings and more"
              data-wb-plus
              className={cn(
                "mb-0.5 inline-flex size-8 flex-none items-center justify-center rounded-lg text-[var(--pg-dim)] transition-colors hover:bg-[oklch(var(--ink)/5%)] hover:text-foreground data-[state=open]:bg-[oklch(var(--ink)/6%)] data-[state=open]:text-foreground",
                focusRing,
              )}
            >
              <Plus className="size-[18px]" aria-hidden />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal container={portal}>
              <DropdownMenu.Content
                ref={menuRef}
                side="top"
                align="start"
                sideOffset={8}
                onPointerDown={(e) => {
                  keyed.current = false;
                  touched.current = e.pointerType === "touch";
                }}
                onKeyDown={(e) => {
                  keyed.current = true;
                  if (shown && e.key === "ArrowLeft") {
                    e.preventDefault();
                    setList(null);
                  }
                }}
                onCloseAutoFocus={(e) => {
                  const handBack = toPrompt.current && !touched.current;
                  toPrompt.current = false;
                  if (!handBack) return;
                  e.preventDefault();
                  box.current?.focus();
                }}
                className={cn(menu, "max-[639px]:w-[19rem]")}
              >
                {shown ? (
                  <>
                    <DropdownMenu.Item
                      data-menu-back
                      onSelect={(e) => {
                        e.preventDefault();
                        setList(null);
                      }}
                      className={cn(menuItem, "font-medium")}
                    >
                      <ChevronLeft aria-hidden />
                      {LIST_TITLE[shown]}
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className={rule} />
                    {lists[shown]}
                  </>
                ) : (
                  <>
                    {/* The design system draws the answer; the model writes it. Switching it repaints every surface. */}
                    <Opens
                      list="design-system"
                      icon={<SwatchBook aria-hidden />}
                      value={
                        <>
                          <span
                            aria-hidden
                            className={cn(
                              "size-2 flex-none rounded-[3px]",
                              SWATCH[designSystem.id],
                            )}
                          />
                          {designSystemLabel(designSystem.id)}
                        </>
                      }
                      inPlace={narrow}
                      onOpen={setList}
                      portal={portal}
                    >
                      {lists["design-system"]}
                    </Opens>
                    <Opens
                      list="model"
                      icon={<Cpu aria-hidden />}
                      value={modelLabel(model)}
                      inPlace={narrow}
                      onOpen={setList}
                      portal={portal}
                    >
                      {lists.model}
                    </Opens>
                    <Opens
                      list="format"
                      icon={<CodeXml aria-hidden />}
                      value={FORMAT_OPTIONS.find((f) => f.id === format)?.label}
                      inPlace={narrow}
                      onOpen={setList}
                      portal={portal}
                    >
                      {lists.format}
                    </Opens>
                    <DropdownMenu.Separator className={rule} />
                    <DropdownMenu.Item
                      onSelect={onStartWithoutAI}
                      data-menu-no-ai
                      className={menuItem}
                    >
                      <Braces aria-hidden />
                      <span className="flex flex-col">
                        Start without AI
                        <span className="text-[11.5px] text-[var(--pg-dim)]">
                          Write A2UI JSON by hand
                        </span>
                      </span>
                    </DropdownMenu.Item>
                    <Opens
                      list="prompts"
                      icon={<Lightbulb aria-hidden />}
                      inPlace={narrow}
                      onOpen={setList}
                      portal={portal}
                    >
                      {lists.prompts}
                    </Opens>
                    {started ? (
                      <>
                        <DropdownMenu.Separator className={rule} />
                        <DropdownMenu.Item
                          onSelect={() => {
                            toPrompt.current = true;
                            newChat();
                          }}
                          data-new-chat
                          className={menuItem}
                        >
                          <SquarePen aria-hidden />
                          New chat
                        </DropdownMenu.Item>
                      </>
                    ) : null}
                  </>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <label htmlFor="wb-prompt" className="sr-only">
            What should the agent build?
          </label>
          <textarea
            id="wb-prompt"
            ref={box}
            value={ghost ?? text}
            onChange={(e) => {
              if (ghost !== null) {
                replay.stop();
                // The visitor's keystroke, without the replay's text in front of it.
                setText(e.target.value.slice(ghost.length));
                return;
              }
              if (replay.status === "playing") replay.stop();
              setText(e.target.value);
            }}
            onFocus={() => {
              if (ghost !== null) replay.stop();
            }}
            onKeyDown={onKeyDown}
            rows={1}
            aria-describedby={noteId}
            placeholder={
              compact || narrow
                ? "Ask for a UI, like a ramen map"
                : "Ask for a UI, like a map of ramen spots in Osaka"
            }
            className="block max-h-[168px] min-h-9 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-[7px] text-[15.5px] leading-[1.45] text-foreground outline-none [field-sizing:content] placeholder:text-[var(--pg-dim)] max-[899px]:text-[16px] max-[899px]:leading-[1.4]"
          />
          <p id={noteId} className="sr-only">
            Enter builds it. Shift and Enter adds a line. While a run is going,
            Enter queues the prompt.
          </p>
          {running ? (
            <button
              type="button"
              onClick={stop}
              data-stop
              aria-label="Stop"
              title="Stop"
              className={cn(
                "mb-0.5 inline-flex size-8 flex-none items-center justify-center rounded-[9px] border border-[var(--pg-line-strong)] bg-[var(--pg-raised)] text-foreground transition-colors hover:bg-[oklch(0.925_0.005_285)] dark:hover:bg-[oklch(0.25_0.006_285)]",
                focusRing,
              )}
            >
              <Square className="size-3 fill-current" aria-hidden />
            </button>
          ) : (
            <button
              type="submit"
              data-build
              aria-label="Build it"
              title="Build it"
              className={cn(
                "mb-0.5 inline-flex size-8 flex-none items-center justify-center rounded-[9px] bg-foreground text-background transition-opacity hover:opacity-90",
                !(ghost ?? text).trim() && "opacity-35 hover:opacity-50",
                focusRing,
              )}
            >
              <ArrowUp className="size-[18px]" aria-hidden />
            </button>
          )}
        </form>

        {/* Under the prompt, until the visitor has asked something: the way in without a model (also in the "+"). */}
        {empty ? (
          <p
            className="mt-1.5 pl-1 text-[13px] leading-snug text-[var(--pg-dim)] max-[899px]:text-[12.5px]"
            data-wb-no-ai-line
          >
            Or{" "}
            <button
              type="button"
              onClick={onStartWithoutAI}
              data-start-without-ai
              className={cn(
                "rounded-sm font-medium text-foreground underline decoration-[var(--pg-line-strong)] underline-offset-4 hover:decoration-foreground",
                focusRing,
              )}
            >
              start without AI
            </button>
            <span className="max-[1099px]:hidden">
              : write A2UI JSON by hand.
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
