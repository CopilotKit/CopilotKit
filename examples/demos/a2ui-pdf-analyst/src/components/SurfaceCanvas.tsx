"use client";

import {
  GenerativeUISurface,
  useGenerativeUIFunction,
  useGenerativeUIRuntime,
} from "@copilotkit/react-core/generative-ui";
import type { GenerativeUIChatSurfaceProps } from "@copilotkit/react-core/generative-ui";
import { catalog } from "@/a2ui/catalog";

/* The agents write A2UI v0.9 surfaces into their tool results. The runtime
 * (`generativeUI: { a2uiVersion: "0.9" }`) converts them to generative UI
 * surfaces for the chat. `GenerativeUISurface` with the chat's target id
 * shows the latest of them here, at canvas size, and the chat shows
 * `SurfaceHandoffPill` in its place. */
const CHAT_TARGET = "chat";

/* The big workspace pane. It renders the latest surface of the active
 * thread, so the surface produced by chat renders here at canvas size.
 *
 * A Button click goes to the agent on its own: the runtime hands the v0.9
 * agent the click as
 *   forwardedProps.a2uiAction.userAction = { name, surfaceId, context, ... }
 * and the agent's CopilotKit middleware injects a `log_a2ui_event` tool
 * result so the agent's reasoning step can react. ChoiceChips calls the
 * `selectChip` function, which sends the same `select_chip` action here. */
export function SurfaceCanvas({
  channel,
  emptyState,
}: {
  channel: string;
  emptyState: React.ReactNode;
}) {
  const runtime = useGenerativeUIRuntime();

  useGenerativeUIFunction(catalog, "selectChip", async ({ value, label }) => {
    const surface = runtime?.manager.getSurfaceForTarget(CHAT_TARGET);
    if (!runtime || !surface) return;
    console.log(`[surface-canvas] chip dispatch channel=${channel}`, value);
    // Adds a visible user message so the chat reflects the click, then runs
    // the agent with the action. A click while the agent runs is dropped.
    const result = await runtime.forwardEvent(
      {
        name: "select_chip",
        surfaceId: surface.surfaceId,
        componentId: "",
        context: { value, label },
        userMessage: humanizeAction("select_chip", value),
      },
      channel,
    );
    if (!result.ok)
      console.warn("[surface-canvas] chip dispatch failed", result.error);
  });

  return (
    <div className="h-full overflow-y-auto">
      <GenerativeUISurface
        id={CHAT_TARGET}
        ui={catalog}
        autoScroll={false}
        className="a2ui-surface p-6 md:p-8"
        fallback={
          <div className="h-full flex items-center justify-center p-8">
            {emptyState}
          </div>
        }
      />
    </div>
  );
}

/* What the chat shows in place of a surface: a small pill, so the user has a
 * clear handoff signal while the surface renders in the canvas. Pass it to
 * `<CopilotChat generativeUISurface={SurfaceHandoffPill}>`. */
export function SurfaceHandoffPill(_props: GenerativeUIChatSurfaceProps) {
  return (
    <div className="my-1.5 inline-flex items-center gap-2 max-w-fit px-3 py-2 rounded-full border border-[var(--line)] bg-[color-mix(in_oklab,var(--lilac)_8%,var(--surface))] text-[12.5px] text-[var(--ink)] font-medium leading-none">
      <span className="w-2 h-2 rounded-full bg-[var(--lilac)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--lilac)_30%,transparent)]" />
      <span className="mono uppercase tracking-[0.1em] text-[10.5px] text-[var(--ink)]">
        surface
      </span>
      <span aria-hidden className="text-[var(--ink)]/40">
        →
      </span>
      <span>rendered in the canvas</span>
    </div>
  );
}

function humanizeAction(name: string, hint?: string): string {
  if (name === "select_chip" && hint) return `Switch scope → ${prettify(hint)}`;
  if (hint) return `${prettify(name)} → ${prettify(hint)}`;
  return prettify(name);
}

function prettify(s: string): string {
  return s
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)\w/g, (m) => m.toUpperCase());
}

export function CanvasEmptyState({
  title,
  subtitle,
  hint,
}: {
  title: string;
  subtitle: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="max-w-md text-center flex flex-col items-center gap-3">
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{ background: "var(--brand-gradient)", opacity: 0.85 }}
        aria-hidden
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#0a0a0b"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      </div>
      <h2 className="text-[20px] font-semibold tracking-tight text-[var(--ink)]">
        {title}
      </h2>
      <p className="text-[14px] text-[var(--ink)] leading-relaxed">
        {subtitle}
      </p>
      {hint && <div className="mt-2">{hint}</div>}
    </div>
  );
}
