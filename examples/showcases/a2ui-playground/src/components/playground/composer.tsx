"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { DropdownMenu } from "radix-ui";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CodeXml,
  Lightbulb,
  Square,
  SwatchBook,
  ChartColumn,
  Globe,
  LifeBuoy,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { forgetChat } from "@/components/app/agent-tap";
import { useMode } from "@/components/app/providers";
import type { Mode } from "@/components/app/providers";
import { useSend } from "@/components/app/use-send";
import { DesignSystemLogo } from "@/components/site/design-system-logo";
import { useDesignSystem } from "@/design-systems/context";
import { DESIGN_SYSTEMS, designSystemLabel } from "@/design-systems/registry";
import type { DesignSystemId } from "@/design-systems/registry";
import { FORMAT_OPTIONS, modelLabel } from "@/lib/model-options";
import type { Format, ModelId } from "@/lib/model-options";
import { runStore } from "@/lib/run-store";
import { cn } from "@/lib/utils";
import { withBase } from "@/lib/site";

type Tag = "macro" | "template";

/** The landing's starters: variations on one prompt that draws well (a dashboard of numbers, a chart and a table). */
const STARTERS: Array<{ text: string; Icon: LucideIcon }> = [
  { text: "Q3 sales by region as a dashboard", Icon: ChartColumn },
  { text: "Monthly signups by plan as a dashboard", Icon: Users },
  { text: "Website traffic by channel as a dashboard", Icon: Globe },
  { text: "Support tickets by priority as a dashboard", Icon: LifeBuoy },
];

/** Macros always compose (they expand on the server), whatever the router would pick. Flights is a ready-made template. */
const SUGGESTIONS: Array<{ text: string; tag?: Tag }> = [
  { text: "Q3 sales by region as a dashboard" },
  { text: "Compare three noise-cancelling headphones", tag: "macro" },
  { text: "Live weather report for Lisbon", tag: "macro" },
  { text: "Plan a 3-day Tokyo trip with a map" },
  { text: "Flights from SFO to JFK on Friday", tag: "template" },
];

/** Each model's maker, as its logo (public/brand/models, LobeHub icons). One-colour marks follow the text colour. */
const MODEL_LOGO: Record<ModelId, { file: string; color: boolean }> = {
  gemini: { file: "gemini-color", color: true },
  gemma: { file: "gemma-color", color: true },
  gpt: { file: "openai", color: false },
};

function ModelLogo({ id, small }: { id: ModelId; small?: boolean }) {
  const logo = MODEL_LOGO[id];
  if (!logo) return null;
  if (logo.color)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={withBase(`/brand/models/${logo.file}.svg`)}
        alt=""
        aria-hidden
        className={small ? "size-[13px] flex-none" : "size-4 flex-none"}
      />
    );
  return (
    <span
      aria-hidden
      className={`${small ? "size-[13px]" : "size-4"} flex-none bg-current [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]`}
      style={{
        maskImage: `url(${withBase(`/brand/models/${logo.file}.svg`)})`,
      }}
    />
  );
}

export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wb-violet-ring)]";

/**
 * A short window or a small square (an iframe on CopilotKit's site, a landscape phone): the chrome around the
 * answer shrinks. The same query is in compact.css, which does the shrinking; this is for what CSS cannot change.
 */
const COMPACT =
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
const useCompact = () =>
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

const menu =
  "z-50 min-w-[16rem] max-w-[calc(100vw-2rem)] rounded-xl border outline-none border-[var(--pg-line)] bg-popover p-1 text-popover-foreground shadow-[0_12px_32px_-12px_var(--pg-shadow)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[side=top]:slide-in-from-bottom-1 data-[side=right]:slide-in-from-left-1";
const menuItem =
  "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] leading-snug outline-none select-none data-[highlighted]:bg-[oklch(var(--ink)/5%)] data-[state=open]:bg-[oklch(var(--ink)/5%)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4 [&>svg]:flex-none [&>svg]:text-[var(--pg-dim)]";

const rule = "mx-1 my-1 h-px bg-[var(--pg-line)]";
/** A ghost button on the prompt box's second row that opens a menu (Design, the model): its logo brightens when hovered or open. */
const pickerTrigger =
  "group/pick inline-flex h-8 flex-none items-center gap-1.5 rounded-[8px] px-2 text-[13px] font-medium text-[var(--pg-dim)] transition-[background-color,color] hover:bg-[oklch(var(--ink)/5%)] hover:text-foreground data-[state=open]:bg-[oklch(var(--ink)/6%)] data-[state=open]:text-foreground dark:hover:bg-white/[0.06] dark:data-[state=open]:bg-white/[0.08] [&_.pick-logo]:opacity-80 [&_.pick-logo]:saturate-[.7] [&_.pick-logo]:transition-[filter,opacity] hover:[&_.pick-logo]:opacity-100 hover:[&_.pick-logo]:saturate-100 data-[state=open]:[&_.pick-logo]:opacity-100 data-[state=open]:[&_.pick-logo]:saturate-100";

/** The lists the menus open. */
type List = "design-system" | "model" | "format" | "prompts";
const LIST_TITLE: Record<List, string> = {
  "design-system": "Design system",
  model: "Model",
  format: "Format",
  prompts: "Try a prompt",
};

/**
 * An entry in the Design menu that opens a list: what it sets, the current choice on the right, and the list in a
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
 * The composer, pinned under the conversation (or centered on the landing, with starter cards above it): the
 * prompt box in two rows, the prompt above and under it the Design menu (design system, format, starter
 * prompts), the model picker and Build or Stop. Under the box, New chat once there is a conversation, and
 * until the visitor has asked something, the way in without a model.
 */
export function Composer({
  landing = false,
  noAILine = true,
  empty,
  onSent,
  onStartWithoutAI,
}: {
  /** The empty chat's landing: starter cards above the box, centered, instead of the chips. */
  landing?: boolean;
  /** "Or start without AI" under the box; off while the editor is already open. */
  noAILine?: boolean;
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
  // The prompts to start from belong to an empty chat. After a conversation, the box is for a
  // follow-up and stands alone ("Try a prompt" in the Design menu still lists them).
  const suggest = empty && !landing;
  useTwoRows(chips, suggest);
  // The menus portal into the playground's root rather than <body>: their colours are scoped to `.pg-root`.
  const wrap = useRef<HTMLDivElement>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  // A choice or a starter prompt hands the focus back to the prompt, not to the button that opened the menu.
  // Not on a touch screen, where the keyboard would come up over the answer.
  const toPrompt = useRef(false);
  const touched = useRef(false);
  const onMenuClose = (e: Event) => {
    const handBack = toPrompt.current && !touched.current;
    toPrompt.current = false;
    if (!handBack) return;
    e.preventDefault();
    box.current?.focus();
  };
  useEffect(() => {
    setPortal(wrap.current?.closest<HTMLElement>(".pg-root") ?? null);
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  // On a phone, the Design menu shows a list in place of its entries; elsewhere lists open beside it.
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

  // Starts over: stops a run, empties the chat and its runs and forgets the saved session.
  // A fresh thread id keeps the runtime from bringing the old thread's events back.
  const newChat = () => {
    stop();
    setQueued(null);
    setText("");
    const live = copilotkit.getAgent("default") ?? agent;
    if (live) {
      live.setMessages([]);
      live.threadId = crypto.randomUUID();
    }
    runStore.reset();
    forgetChat();
    box.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  // What the menus open: the design system, format and model pickers, and the starter prompts. The model
  // picker is a menu of its own; the rest are entries of the Design menu.
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
            <DesignSystemLogo id={d.id} className="mt-[2px] size-4" />
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
            <ModelLogo id={m.id} />
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

  return (
    <div
      ref={wrap}
      data-landing={landing || undefined}
      className={cn(
        "wb-composer relative flex-none",
        landing ? "pt-8" : "pb-4 pt-2 max-[899px]:pb-3",
      )}
    >
      <div
        className={cn(
          "mx-auto w-full px-8 max-[1279px]:px-6 max-[899px]:px-4",
          landing ? "max-w-[728px]" : "max-w-[844px]",
        )}
      >
        {landing ? (
          <div className="mb-4" data-wb-starters>
            <h2 className="sr-only">Try one</h2>
            <ul className="grid grid-cols-2 gap-2 max-[599px]:grid-cols-1">
              {STARTERS.map(({ text: t, Icon }, i) => (
                <li
                  key={t}
                  className="wb-rise"
                  style={{ "--rise": i + 2 } as React.CSSProperties}
                >
                  <button
                    type="button"
                    data-suggestion={t}
                    onClick={() => go(t)}
                    className={cn(
                      "group flex h-full w-full items-center gap-3 rounded-[16px] border border-[var(--pg-line-strong)] bg-[var(--pg-panel)] px-3 py-2.5 text-left text-[13.5px] leading-snug text-foreground/80 shadow-[0_10px_30px_-16px_var(--pg-shadow)] transition-[border-color,color,box-shadow] hover:border-[oklch(var(--ink)/22%)] hover:text-foreground dark:hover:border-[oklch(1_0_0/20%)]",
                      focusRing,
                    )}
                  >
                    <span
                      aria-hidden
                      className="grid size-8 flex-none place-items-center rounded-[8px] bg-[oklch(var(--ink)/5%)] text-foreground/70 transition-colors group-hover:bg-foreground group-hover:text-background dark:bg-white/[0.06] dark:group-hover:bg-white/[0.12] dark:group-hover:text-foreground"
                    >
                      <Icon className="size-4" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0">{t}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {suggest ? (
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
          style={landing ? ({ "--rise": 6 } as React.CSSProperties) : undefined}
          onClick={(e) => {
            // A click on the box's padding goes to the prompt, as in any two-row composer.
            if (e.target === e.currentTarget) box.current?.focus();
          }}
          className={cn(
            "wb-prompt flex flex-col gap-1 rounded-[16px] border border-[var(--pg-line-strong)] bg-[var(--pg-panel)] p-2 shadow-[0_10px_30px_-12px_var(--pg-shadow)] transition-[border-color,box-shadow] hover:border-[oklch(var(--ink)/22%)] dark:hover:border-[oklch(1_0_0/20%)] has-[textarea:focus-visible]:border-[oklch(var(--ink)/28%)] has-[textarea:focus-visible]:shadow-[0_0_0_4px_oklch(var(--ink)/5%),0_10px_30px_-12px_var(--pg-shadow)] dark:has-[textarea:focus-visible]:border-white/25 dark:has-[textarea:focus-visible]:shadow-[0_0_0_4px_oklch(1_0_0/5%),0_10px_30px_-12px_var(--pg-shadow)]",
            landing && "wb-rise",
          )}
        >
          <label htmlFor="wb-prompt" className="sr-only">
            What should the agent build?
          </label>
          <textarea
            id="wb-prompt"
            ref={box}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            aria-describedby={noteId}
            placeholder={
              compact || narrow
                ? "Ask for a UI, like a ramen map"
                : "Ask for a UI, like a map of ramen spots in Osaka"
            }
            className="block max-h-[220px] min-h-[52px] w-full min-w-0 resize-none bg-transparent px-2.5 pb-1 pt-1.5 text-[15.5px] leading-[1.5] text-foreground outline-none [field-sizing:content] placeholder:text-[13px] placeholder:text-foreground/35 max-[899px]:text-[16px] max-[899px]:leading-[1.4]"
          />
          <p id={noteId} className="sr-only">
            Enter builds it. Shift and Enter adds a line. While a run is going,
            Enter queues the prompt.
          </p>
          {/* The second row: the A2UI design settings on the left, the model and Build on the right. */}
          <div className="flex items-center gap-0.5">
            <DropdownMenu.Root
              open={menuOpen}
              onOpenChange={(open) => {
                setMenuOpen(open);
                // Each time it opens, the menu starts at its top level.
                if (open) setList(null);
              }}
            >
              <DropdownMenu.Trigger
                aria-label="Design: components, format, starters and more"
                title="Design"
                data-wb-plus
                className={cn(pickerTrigger, focusRing)}
              >
                <span className="pick-logo inline-flex">
                  <DesignSystemLogo id={designSystem.id} className="size-3.5" />
                </span>
                <span>Design</span>
                <span className="text-[var(--pg-dim)]/70 max-[479px]:hidden">
                  · {designSystemLabel(designSystem.id)}
                </span>
                <ChevronDown className="size-3.5 opacity-60" aria-hidden />
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
                  onCloseAutoFocus={onMenuClose}
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
                            <DesignSystemLogo
                              id={designSystem.id}
                              className="size-3.5"
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
                        list="format"
                        icon={<CodeXml aria-hidden />}
                        value={
                          FORMAT_OPTIONS.find((f) => f.id === format)?.label
                        }
                        inPlace={narrow}
                        onOpen={setList}
                        portal={portal}
                      >
                        {lists.format}
                      </Opens>
                      <DropdownMenu.Separator className={rule} />
                      <Opens
                        list="prompts"
                        icon={<Lightbulb aria-hidden />}
                        inPlace={narrow}
                        onOpen={setList}
                        portal={portal}
                      >
                        {lists.prompts}
                      </Opens>
                    </>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <div className="ml-auto flex items-center gap-1">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger
                  aria-label={`Model: ${modelLabel(model)}`}
                  data-wb-model
                  className={cn(pickerTrigger, focusRing)}
                >
                  <span className="pick-logo inline-flex">
                    <ModelLogo id={model} small />
                  </span>
                  <span className="max-[379px]:hidden">
                    {modelLabel(model)}
                  </span>
                  <ChevronDown className="size-3.5 opacity-60" aria-hidden />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal container={portal}>
                  <DropdownMenu.Content
                    side="top"
                    align="end"
                    sideOffset={8}
                    onPointerDown={(e) => {
                      touched.current = e.pointerType === "touch";
                    }}
                    onKeyDown={() => {
                      touched.current = false;
                    }}
                    onCloseAutoFocus={onMenuClose}
                    className={cn(menu, "max-[639px]:w-[17rem]")}
                  >
                    <DropdownMenu.Label className="px-2 pb-1 pt-1.5 text-[12px] font-medium text-[var(--pg-dim)]">
                      Model
                    </DropdownMenu.Label>
                    {lists.model}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
              {running ? (
                <button
                  type="button"
                  onClick={stop}
                  data-stop
                  aria-label="Stop"
                  title="Stop"
                  className={cn(
                    "ml-0.5 inline-flex size-8 flex-none items-center justify-center rounded-[8px] bg-[oklch(var(--ink)/7%)] text-foreground dark:bg-white/[0.1] transition-colors hover:bg-[oklch(0.925_0.005_285)] dark:hover:bg-[oklch(0.25_0.006_285)]",
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
                    "ml-0.5 inline-flex size-8 flex-none items-center justify-center rounded-[8px] transition-[background-color,color,transform] active:scale-95",
                    text.trim()
                      ? "bg-foreground text-background hover:opacity-90"
                      : "text-foreground/30",
                    focusRing,
                  )}
                >
                  <ArrowUp className="size-4" strokeWidth={2.25} aria-hidden />
                </button>
              )}
            </div>
          </div>
        </form>

        {/* Under the prompt, once there is a conversation: a quiet way to start over. */}
        {!empty ? (
          <p
            className="mt-2 text-center text-[13px] leading-snug max-[899px]:text-[12.5px]"
            data-wb-new-chat-line
          >
            <button
              type="button"
              onClick={newChat}
              data-new-chat
              className={cn(
                "rounded-sm text-[var(--pg-dim)] underline decoration-[var(--pg-line-strong)] underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground",
                focusRing,
              )}
            >
              New chat
            </button>
          </p>
        ) : null}

        {/* Under the prompt, until the visitor has asked something: the way in without a model. */}
        {empty && noAILine ? (
          <p
            className={cn(
              "mt-1.5 text-[13px] leading-snug text-[var(--pg-dim)] max-[899px]:text-[12.5px]",
              landing ? "wb-rise mt-3 text-center" : "pl-1",
            )}
            style={
              landing ? ({ "--rise": 7 } as React.CSSProperties) : undefined
            }
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
