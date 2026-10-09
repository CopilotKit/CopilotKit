"use client";
/**
 * AdaptiveLegend — legend that only shows symbols relevant to
 * currently active overlays.
 */

import { useState } from "react";
import type { Overlay } from "@/lib/overlay-types";
import { GLYPH_LIST } from "@/lib/glyphs";
import type { GlyphSpec } from "@/lib/glyphs";
import { StatusChip, GlyphMark } from "@/components/badges";

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
        All Pills: every feature type the integration declares is run (D5 runs
        one representative); green only if all pass
      </LegendItem>
      <LegendItem>
        <span className="font-semibold text-[var(--text-secondary)]">
          UI / BE / 1P / D6
        </span>
        per-rung marks, each with its own prefix — detail under the cell&rsquo;s
        depth chip
      </LegendItem>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Glyph vocabulary — GENERATED from `GLYPH_LIST`                     */
/* ------------------------------------------------------------------ */

/**
 * One legend row per glyph, mapped straight off the SAME constant the renderer
 * switches on (`@/lib/glyphs`). A glyph cannot be emitted without a legend row
 * because there is only one place to add one — and
 * `glyphs.contract.test.tsx` fails CI if the two sets ever diverge.
 *
 * Each row shows the glyph in BOTH forms it can take: the chip (the cell's one
 * filled-or-hollow object) and the bare mark (a rung's detail).
 */
function GlyphLegendItem({ spec }: { spec: GlyphSpec }) {
  return (
    <LegendItem>
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        <StatusChip tone="gray" label={spec.mark} />
        <GlyphMark label={spec.mark} tone="gray" />
      </span>
      <span>
        <span className="font-semibold text-[var(--text-secondary)]">
          {spec.term}
        </span>{" "}
        — {spec.legend}
      </span>
    </LegendItem>
  );
}

function GlyphLegend() {
  const verdicts = GLYPH_LIST.filter((g) => g.glyphClass === "verdict");
  const absences = GLYPH_LIST.filter((g) => g.glyphClass === "absence");
  return (
    <>
      <LegendItem>
        <span className="font-semibold text-[var(--text-secondary)]">
          A filled chip is a result. A hollow chip is not a result —
        </span>
        never read a hollow chip as a failure.
      </LegendItem>
      <LegendItem>
        <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-secondary)]">
          Result
        </span>
        a probe ran and judged this cell
      </LegendItem>
      {verdicts.map((g) => (
        <GlyphLegendItem key={g.id} spec={g} />
      ))}
      <LegendItem>
        <span className="font-semibold text-[var(--text-secondary)]">
          D0&ndash;D6
        </span>
        depth reached — green at this cell&rsquo;s ceiling, amber 1&ndash;2
        below, red 3+ below, grey at D0
      </LegendItem>
      <LegendItem>
        <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-secondary)]">
          No result
        </span>
        nothing was judged here
      </LegendItem>
      {absences.map((g) => (
        <GlyphLegendItem key={g.id} spec={g} />
      ))}
      <LegendItem>
        <span className="font-semibold text-[var(--text-secondary)]">
          Starter rows
        </span>
        use this same vocabulary with the same meanings
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
      <span className="font-semibold text-[var(--text-secondary)]">
        docs-og / docs-shell
      </span>
      inline text in the same vocabulary — present, missing or opted out, 404,
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
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function AdaptiveLegend({ overlays }: AdaptiveLegendProps) {
  /**
   * CLOSED by default. The legend is `position: fixed` and ~152px tall while
   * the grid reserves only `pb-12` (48px) under it, so an open-by-default
   * legend sat on top of the last rows: at 1440x900, fully scrolled, it hid 42
   * of the 84 starter cells with nothing on screen saying it could be
   * collapsed. One click still opens it.
   *
   * No persistence: this component has never had any, and adding a
   * localStorage key is out of scope here.
   */
  const [open, setOpen] = useState(false);

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
          <GlyphLegend />
          <AlwaysLegend />
        </div>
      )}
    </div>
  );
}
