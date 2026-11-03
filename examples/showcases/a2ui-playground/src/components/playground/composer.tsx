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
} from "react";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { DropdownMenu } from "radix-ui";
import {
  ArrowUp,
  Braces,
  ChevronRight,
  Lightbulb,
  Plus,
  Square,
  SquarePen,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

/** The pickers under the prompt: quiet text that names the choice, no box until hovered. */
const trigger =
  "h-7 flex-none gap-1 rounded-lg border-transparent bg-transparent pl-2 pr-1.5 text-[12.5px] text-[var(--pg-dim)] shadow-none hover:bg-[oklch(var(--ink)/4%)] hover:text-foreground data-[state=open]:text-foreground dark:bg-transparent dark:hover:bg-[oklch(var(--ink)/4%)] [&>svg]:size-3.5";

const menu =
  "z-50 min-w-[15rem] rounded-xl border outline-none border-[var(--pg-line)] bg-popover p-1 text-popover-foreground shadow-[0_12px_32px_-12px_var(--pg-shadow)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[side=top]:slide-in-from-bottom-1 data-[side=right]:slide-in-from-left-1";
const menuItem =
  "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] leading-snug outline-none select-none data-[highlighted]:bg-[oklch(var(--ink)/5%)] data-[state=open]:bg-[oklch(var(--ink)/5%)] [&>svg]:size-4 [&>svg]:flex-none [&>svg]:text-[var(--pg-dim)]";

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
 * something), the prompt box (a "+" menu, the prompt, Build or Stop), and under it the way in without a
 * model and the design system, model and format pickers.
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
  // A new chat or a starter prompt hands the focus back to the prompt, not to the "+" that opened the menu.
  const toPrompt = useRef(false);
  useEffect(() => {
    setPortal(wrap.current?.closest<HTMLElement>(".pg-root") ?? null);
  }, []);

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
          {/* The less-used ways in, out of the way of the prompt: writing JSON by hand, a starter prompt, a new chat. */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              aria-label="More"
              title="More"
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
                side="top"
                align="start"
                sideOffset={8}
                onCloseAutoFocus={(e) => {
                  if (!toPrompt.current) return;
                  toPrompt.current = false;
                  e.preventDefault();
                  box.current?.focus();
                }}
                className={menu}
              >
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
                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger className={menuItem}>
                    <Lightbulb aria-hidden />
                    Try a prompt
                    <ChevronRight className="ml-auto" aria-hidden />
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal container={portal}>
                    <DropdownMenu.SubContent
                      sideOffset={6}
                      className={cn(menu, "w-[19rem]")}
                    >
                      {SUGGESTIONS.map((s) => (
                        <DropdownMenu.Item
                          key={s.text}
                          onSelect={() => {
                            toPrompt.current = true;
                            go(
                              s.text,
                              s.tag === "macro" ? "dynamic" : undefined,
                            );
                          }}
                          className={menuItem}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {s.text}
                          </span>
                          {s.tag ? <SuggestionTag tag={s.tag} /> : null}
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
                {started ? (
                  <>
                    <DropdownMenu.Separator className="mx-1 my-1 h-px bg-[var(--pg-line)]" />
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

        {/* Under the prompt, quiet: the way in without a model, and what draws, writes and formats the answer. */}
        <div
          className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1"
          data-wb-under
        >
          <p
            className="pl-1 text-[13px] leading-snug text-[var(--pg-dim)] max-[899px]:text-[12.5px]"
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
          {/* A row of its own only in a small frame, where it scrolls sideways. */}
          <div
            className="ml-auto flex flex-none items-center gap-0.5 max-[639px]:-ml-1"
            data-wb-pickers
          >
            {/* The design system draws the answer; the model writes it. Switching it repaints every surface. */}
            <Select
              value={designSystem.id}
              onValueChange={(v) => designSystem.setId(v as DesignSystemId)}
            >
              <SelectTrigger
                size="sm"
                aria-label="Design system"
                data-design-system-picker
                className={trigger}
              >
                <SelectValue>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 flex-none rounded-[3px]",
                        SWATCH[designSystem.id],
                      )}
                    />
                    {designSystemLabel(designSystem.id)}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent position="popper" align="start" side="top">
                {DESIGN_SYSTEMS.map((d) => (
                  <SelectItem key={d.id} value={d.id} data-design-system={d.id}>
                    <span className="flex items-start gap-2.5">
                      <span
                        aria-hidden
                        className={cn(
                          "mt-[5px] size-2 flex-none rounded-[3px]",
                          SWATCH[d.id],
                        )}
                      />
                      <span className="flex flex-col items-start gap-0.5">
                        <span>
                          {d.label}{" "}
                          <span className="text-muted-foreground">
                            {d.note}
                          </span>
                        </span>
                        <span className="max-w-[17rem] text-[11.5px] leading-snug text-muted-foreground">
                          {d.hint}
                        </span>
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={model} onValueChange={(v) => setModel(v as ModelId)}>
              <SelectTrigger
                size="sm"
                aria-label="Model"
                data-model-picker
                className={trigger}
              >
                <SelectValue>{modelLabel(model)}</SelectValue>
              </SelectTrigger>
              <SelectContent position="popper" align="start" side="top">
                {models.map((m) => (
                  <SelectItem
                    key={m.id}
                    value={m.id}
                    data-model={m.id}
                    disabled={!m.available}
                  >
                    <span className="flex flex-col items-start gap-0.5">
                      <span>
                        {m.label}{" "}
                        <span className="text-muted-foreground">{m.note}</span>
                      </span>
                      {!m.available && m.reason ? (
                        <span className="max-w-[16rem] text-[11.5px] leading-snug text-muted-foreground">
                          Not available here. {m.reason}
                        </span>
                      ) : null}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={format}
              onValueChange={(v) => setFormat(v as Format)}
            >
              <SelectTrigger
                size="sm"
                aria-label="Format the model writes"
                data-format-picker
                className={trigger}
              >
                <SelectValue>
                  {FORMAT_OPTIONS.find((f) => f.id === format)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent position="popper" align="start" side="top">
                {FORMAT_OPTIONS.map((f) => (
                  <SelectItem key={f.id} value={f.id} data-format={f.id}>
                    <span className="flex flex-col items-start gap-0.5">
                      <span>{f.label}</span>
                      <span className="max-w-[16rem] text-[11.5px] leading-snug text-muted-foreground">
                        {f.hint}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Small frames: the "Or start without AI" line folds in here. */}
            <button
              type="button"
              onClick={onStartWithoutAI}
              data-wb-no-ai-inline
              className={cn(
                "hidden h-7 flex-none items-center whitespace-nowrap rounded-lg px-2 text-[12.5px] font-medium text-[var(--pg-dim)] underline decoration-[var(--pg-line-strong)] underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground",
                focusRing,
              )}
            >
              Start without AI
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
