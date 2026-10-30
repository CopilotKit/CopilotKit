"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { ArrowUp, Square } from "lucide-react";
import { useMode, type Mode } from "@/components/app/providers";
import { useSend } from "@/components/app/use-send";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FORMAT_OPTIONS, modelLabel, type Format, type ModelId } from "@/lib/model-options";
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

export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wb-violet-ring)]";

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
      const rows = [...new Set(items.map((li) => li.offsetTop))].sort((a, b) => a - b);
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
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [ref, on]);
}

const trigger = "h-8 flex-none rounded-lg border-[var(--pg-line-strong)] bg-transparent text-[13px] text-[var(--pg-dim)] hover:text-foreground dark:bg-transparent dark:hover:bg-white/[0.04]";

/**
 * The composer, pinned under the conversation: a few prompts to start from (until the visitor has asked
 * something), the prompt box with model, format and Build or Stop, and the way in without a model.
 */
export function Composer({ replay, empty, onSent, onStartWithoutAI }: { replay: Replay; empty: boolean; onSent: () => void; onStartWithoutAI: () => void }) {
  const { model, setModel, format, setFormat, models } = useMode();
  const { send, running } = useSend();
  const { agent } = useAgent({ agentId: "default", updates: [] });
  const { copilotkit } = useCopilotKit();
  const [text, setText] = useState("");
  const [queued, setQueued] = useState<{ text: string; mode?: Mode } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const chips = useRef<HTMLUListElement>(null);
  const noteId = useId();
  useTwoRows(chips, empty);

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

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  // While the replay types its prompt, the box shows it; the visitor's own typing takes over at once.
  const ghost = replay.status === "playing" && !replay.sent ? replay.typed : null;

  return (
    <div className="wb-composer relative flex-none pb-4 pt-2 max-[899px]:pb-3">
      <div className="mx-auto w-full max-w-[844px] px-8 max-[1279px]:px-6 max-[899px]:px-4">
        {empty ? (
          <div className="mb-2.5">
            <h2 className="sr-only">Try one</h2>
            {/* At most two rows, so the conversation keeps its room: the prompts that would start a third are hidden. */}
            <ul ref={chips} className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <li key={s.text} className="min-w-0 max-w-full">
                  <button
                    type="button"
                    data-suggestion={s.text}
                    onClick={() => go(s.text, s.tag === "macro" ? "dynamic" : undefined)}
                    className={cn(
                      "flex max-w-full items-center gap-2 rounded-[9px] border border-[var(--pg-line)] px-3 py-1.5 text-[13px] leading-snug text-[var(--pg-dim)] transition-colors hover:border-[var(--pg-line-strong)] hover:bg-white/[0.025] hover:text-foreground max-[899px]:rounded-full",
                      focusRing,
                    )}
                  >
                    <span className="truncate">{s.text}</span>
                    {s.tag ? (
                      <span className={cn("flex-none font-mono text-[11px]", s.tag === "macro" ? "text-[var(--wb-amber)]" : "text-[var(--pg-fixed)]")} title={s.tag === "macro" ? "One line from the model, expanded into standard components on the server" : "A ready-made layout: the model fills in data only"}>
                        {s.tag}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {queued ? (
          <div role="status" className="mb-2 flex items-center gap-3 text-[13px] text-[var(--pg-dim)]">
            <span className="min-w-0 truncate">
              Next: <span className="text-foreground">{queued.text}</span>. It sends when this answer is done.
            </span>
            <button
              type="button"
              onClick={() => {
                setText(queued.text);
                setQueued(null);
              }}
              className={cn("ml-auto flex-none rounded-md border border-[var(--pg-line)] px-2 py-0.5 text-[12px] transition-colors hover:text-foreground", focusRing)}
            >
              Cancel
            </button>
          </div>
        ) : null}

        <form
          onSubmit={submit}
          aria-label="Ask for a UI"
          className="wb-prompt rounded-[14px] border border-[var(--pg-line-strong)] bg-[var(--pg-surface)] shadow-[0_10px_30px_-12px_oklch(0_0_0/60%)] transition-[border-color,box-shadow] hover:border-[oklch(1_0_0/20%)] has-[textarea:focus-visible]:border-[var(--wb-violet)] has-[textarea:focus-visible]:shadow-[0_0_0_3px_var(--wb-violet-glow),0_10px_30px_-12px_oklch(0_0_0/60%)]"
        >
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
            rows={2}
            aria-describedby={noteId}
            placeholder="Ask for a UI, like a map of ramen spots in Osaka"
            className="block max-h-[168px] min-h-[54px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-[15.5px] leading-[1.45] text-foreground outline-none [field-sizing:content] placeholder:text-[var(--pg-dim)] max-[899px]:min-h-[46px] max-[899px]:text-[16px]"
          />
          <p id={noteId} className="sr-only">
            Enter builds it. Shift and Enter adds a line. While a run is going, Enter queues the prompt.
          </p>
          <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
            <Select value={model} onValueChange={(v) => setModel(v as ModelId)}>
              <SelectTrigger size="sm" aria-label="Model" data-model-picker className={trigger}>
                <SelectValue>{modelLabel(model)}</SelectValue>
              </SelectTrigger>
              <SelectContent position="popper" align="start" side="top">
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id} data-model={m.id} disabled={!m.available}>
                    <span className="flex flex-col items-start gap-0.5">
                      <span>
                        {m.label} <span className="text-muted-foreground">{m.note}</span>
                      </span>
                      {!m.available && m.reason ? <span className="max-w-[16rem] text-[11.5px] leading-snug text-muted-foreground">Not available here. {m.reason}</span> : null}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
              <SelectTrigger size="sm" aria-label="Format the model writes" data-format-picker className={trigger}>
                <SelectValue>{FORMAT_OPTIONS.find((f) => f.id === format)?.label}</SelectValue>
              </SelectTrigger>
              <SelectContent position="popper" align="start" side="top">
                {FORMAT_OPTIONS.map((f) => (
                  <SelectItem key={f.id} value={f.id} data-format={f.id}>
                    <span className="flex flex-col items-start gap-0.5">
                      <span>{f.label}</span>
                      <span className="max-w-[16rem] text-[11.5px] leading-snug text-muted-foreground">{f.hint}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {running ? (
              <button
                type="button"
                onClick={stop}
                data-stop
                className={cn("ml-auto inline-flex h-9 flex-none items-center gap-2 rounded-[9px] border border-[var(--pg-line-strong)] bg-[var(--pg-raised)] px-3.5 text-[14px] font-medium text-foreground transition-colors hover:bg-[oklch(0.25_0.006_285)]", focusRing)}
              >
                <Square className="size-3 fill-current" aria-hidden />
                Stop
              </button>
            ) : (
              <button
                type="submit"
                data-build
                className={cn("ml-auto inline-flex h-9 flex-none items-center gap-1.5 rounded-[9px] bg-foreground px-3.5 text-[14px] font-semibold text-background transition-opacity hover:opacity-90", focusRing)}
              >
                Build it
                <ArrowUp className="size-4" aria-hidden />
              </button>
            )}
          </div>
        </form>

        <p className="mt-2 text-[13px] leading-snug text-[var(--pg-dim)] max-[899px]:text-[12.5px]">
          Or{" "}
          <button type="button" onClick={onStartWithoutAI} data-start-without-ai className={cn("rounded-sm font-medium text-foreground underline decoration-[var(--pg-line-strong)] underline-offset-4 hover:decoration-foreground", focusRing)}>
            start without AI
          </button>
          <span className="max-[479px]:hidden">: write A2UI JSON by hand and watch it render.</span>
          <span className="min-[480px]:hidden">: write A2UI JSON by hand.</span>
        </p>
      </div>
    </div>
  );
}
