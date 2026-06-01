"use client";
/**
 * ChipsExplainer — collapsible "What do these chips mean?" panel that sits
 * above StatsBar on the Cells tab. Default-collapsed; persists open/closed
 * state across navigations via `localStorage["chip-explainer-open"]`.
 *
 * The Cells tab is consulted dozens of times a day by operators who already
 * know what D0–D6 mean; the explainer is for first-time viewers / rare
 * refreshers, so the trigger is small and the default is collapsed.
 */
import { useEffect, useId, useState } from "react";

const STORAGE_KEY = "chip-explainer-open";
const NOTION_URL =
  "https://www.notion.so/copilotkit/34e3aa38185281d7bf2ac3ea9d474b36";

interface LayerDef {
  id: string;
  body: string;
}

const LAYERS: LayerDef[] = [
  { id: "D0", body: "is this feature wired up at all in this integration?" },
  {
    id: "D1",
    body: "does the integration's server respond to a basic health ping?",
  },
  { id: "D2", body: "does it respond to a basic Copilot API call?" },
  { id: "D3", body: "does the demo page even load in a browser?" },
  {
    id: "D4",
    body: "can a human send a single chat message and get a sensible response?",
  },
  {
    id: "D5",
    body: "does the integration actually do its complex agentic stuff correctly? (multi-turn memory, tool-card rendering, shared-state read/write, HITL flows, gen-UI components, MCP/subagent chaining)",
  },
  {
    id: "D6",
    body: "does its behaviour match the reference (LangGraph Python), or has it drifted? (DOM elements, tool-call sequence, stream cadence, contract shape — informational; weekly rotation)",
  },
];

/**
 * Read the persisted open flag synchronously on mount. Guarded against SSR
 * (no `window` / `localStorage` on the server) — defaults to collapsed there.
 */
function readPersistedOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // localStorage can throw in private-mode Safari; fall back to default.
    return false;
  }
}

export function ChipsExplainer() {
  // Initialize from localStorage so the first paint matches the persisted
  // state (no flash from collapsed → expanded on revisit). The same read
  // also runs on the server during SSR but returns false safely.
  const [open, setOpen] = useState<boolean>(readPersistedOpen);
  const panelId = useId();

  // Persist on every change. Wrapped in a try/catch so quota / private-mode
  // failures don't break the UI.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, open ? "true" : "false");
    } catch {
      // ignore — UI state still works without persistence.
    }
  }, [open]);

  const chevron = open ? "\u25BE" : "\u25B8"; // ▾ / ▸

  return (
    <div data-testid="chips-explainer" className="px-4 pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] rounded"
      >
        <span aria-hidden="true" className="tabular-nums">
          {chevron}
        </span>
        <span>What do these chips mean?</span>
      </button>
      {open && (
        <div
          id={panelId}
          data-testid="chips-explainer-panel"
          className="mt-2 rounded-md border border-[var(--text-muted)]/20 bg-[var(--text-muted)]/5 px-4 py-3 text-xs text-[var(--text)]"
        >
          <ul className="space-y-1.5">
            {LAYERS.map((layer) => (
              <li key={layer.id}>
                <span className="font-semibold text-[var(--accent)]">
                  {layer.id}:
                </span>{" "}
                <span>{layer.body}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <a
              href={NOTION_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] hover:underline"
            >
              More detail →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
