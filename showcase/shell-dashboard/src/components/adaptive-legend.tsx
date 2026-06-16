"use client";
/**
 * AdaptiveLegend — legend that only shows symbols relevant to
 * currently active overlays.
 */

import { useState } from "react";
import type { Overlay } from "@/lib/overlay-types";

export interface AdaptiveLegendProps {
  overlays: Set<Overlay>;
}

/** Single legend entry — inline flex with icon/symbol + explanation. */
function LegendItem({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1.5">{children}</div>;
}

/* ------------------------------------------------------------------ */
/*  Section renderers                                                  */
/* ------------------------------------------------------------------ */

function LinksLegend() {
  return (
    <>
      <LegendItem>
        <span className="text-[var(--accent)] font-medium">Demo ↗</span>
        open hosted preview
      </LegendItem>
      <LegendItem>
        <span className="text-[var(--accent)] font-medium">Code {"</>"}</span>
        open source
      </LegendItem>
    </>
  );
}

function DepthLegend() {
  return (
    <LegendItem>
      <span className="font-semibold text-[var(--text-secondary)]">
        L1-L4 Strip
      </span>
      per-integration health levels shown in column header
    </LegendItem>
  );
}

function HealthLegend() {
  return (
    <>
      {/* Depth explanations in ascending order */}
      <LegendItem>
        <span className="font-semibold text-[var(--text-secondary)]">
          Health
        </span>
        GET /api/health returns 200 OK with JSON body
      </LegendItem>
      <LegendItem>
        <span className="font-semibold text-[var(--text-secondary)]">D2</span>
        API (HTTP): backend service is up and HTTP-reachable
      </LegendItem>
      <LegendItem>
        <span className="font-semibold text-[var(--text-secondary)]">D3</span>
        UI (Frontend): demo page renders in browser (Playwright)
      </LegendItem>
      <LegendItem>
        <span className="font-semibold text-[var(--text-secondary)]">D4</span>
        BE (Agent): single message round-trip — agent processes a chat message
        end-to-end
      </LegendItem>
      <LegendItem>
        <span className="font-semibold text-[var(--text-secondary)]">D5</span>
        Single Pill (1P): one scripted conversation from the canonical aimock
        fixture set; D6 runs all pills
      </LegendItem>
      <LegendItem>
        <span className="font-semibold text-[var(--text-secondary)]">D6</span>
        Parity (Reference): full all-pills run verified against the reference
        integration
      </LegendItem>
      {/* Regression indicator */}
      <LegendItem>
        <span className="text-[var(--danger)] font-medium">▼</span>
        depth regression from previous run
      </LegendItem>
      {/* D4/D5 color chips */}
      <LegendItem>
        <span className="text-[var(--ok)]">D4 ✓</span>/
        <span className="text-[var(--amber)]">~</span>/
        <span className="text-[var(--danger)]">✗</span>
        round-trip check (green &lt;1h / amber stale / red fail)
      </LegendItem>
      <LegendItem>
        <span className="text-[var(--ok)]">D5</span>/
        <span className="text-[var(--amber)]">D5</span>/
        <span className="text-[var(--danger)]">D5</span>
        single-pill check (green pass / amber stale / red fail)
      </LegendItem>
      <LegendItem>
        <span className="text-[var(--ok)]">D6</span>/
        <span className="text-[var(--amber)]">D6</span>/
        <span className="text-[var(--danger)]">D6</span>
        parity check (green pass / amber stale / red fail)
      </LegendItem>
      {/* Status symbols */}
      <LegendItem>
        <span className="text-[var(--text-muted)]">?</span>
        probe has not yet ticked since deploy
      </LegendItem>
      <LegendItem>
        <span className="text-[var(--text-muted)]">—</span>
        supported, no demo yet
      </LegendItem>
    </>
  );
}

function ParityLegend() {
  return (
    <>
      <LegendItem>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border bg-purple-600/20 text-purple-400 border-purple-500/30">
          REF
        </span>
        reference integration (feature-complete baseline)
      </LegendItem>
      <LegendItem>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border bg-[var(--ok)]/20 text-[var(--ok)] border-[var(--ok)]/30">
          AT PARITY
        </span>
        matches reference across all features
      </LegendItem>
      <LegendItem>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border bg-[var(--amber)]/20 text-[var(--amber)] border-[var(--amber)]/30">
          PARTIAL
        </span>
        some features wired, some missing
      </LegendItem>
      <LegendItem>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border bg-[var(--amber)]/20 text-[var(--amber)] border-[var(--amber)]/30 opacity-60">
          MINIMAL
        </span>
        basic wiring only
      </LegendItem>
      <LegendItem>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border bg-[var(--text-muted)]/10 text-[var(--text-muted)] border-[var(--text-muted)]/20">
          NOT WIRED
        </span>
        integration exists in catalog but not wired
      </LegendItem>
    </>
  );
}

function DocsLegend() {
  return (
    <LegendItem>
      <span className="text-[var(--ok)]">docs-og ✓</span>
      {" / "}
      <span className="text-[var(--text-muted)]">·</span>
      {" / "}
      <span className="text-[var(--danger)]">docs-shell ✗</span>
      {" / "}
      <span className="text-[var(--amber)]">!</span> docs: ok / missing / 404 /
      probe error
    </LegendItem>
  );
}

/** Always-shown legend items regardless of active overlays. */
function AlwaysLegend() {
  return (
    <>
      <LegendItem>
        <span className="text-[var(--text-secondary)]">testing</span>
        rows are muted &amp; hide docs (primary feature = has docs)
      </LegendItem>
      <LegendItem>
        <span className="text-[var(--danger)]">✗</span>
        not supported
      </LegendItem>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function AdaptiveLegend({ overlays }: AdaptiveLegendProps) {
  const [open, setOpen] = useState(true);

  return (
    <div
      data-testid="adaptive-legend"
      className="fixed bottom-0 left-0 right-0 z-40 bg-[var(--bg-surface)] border-t border-[var(--border)]"
    >
      <div className="flex items-center px-4 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer bg-transparent border-none p-0"
        >
          <span
            className="inline-block transition-transform"
            style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            ▶
          </span>
          Legend
        </button>
      </div>
      {open && (
        <div className="px-8 pb-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-[var(--text-muted)]">
          {overlays.has("links") && <LinksLegend />}
          {overlays.has("depth") && <DepthLegend />}
          {overlays.has("health") && <HealthLegend />}
          {overlays.has("parity") && <ParityLegend />}
          {overlays.has("docs") && <DocsLegend />}
          <AlwaysLegend />
        </div>
      )}
    </div>
  );
}
