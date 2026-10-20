/**
 * The vocabulary's two anti-rot guards.
 *
 * The legend rotted before because it was hand-written prose sitting next to
 * hand-written JSX in a different file: it claimed `✗` meant "not supported"
 * (false in both grids), documented a `▼` nothing emitted, documented a `?`
 * the main grid suppressed, and never mentioned `🚫` at all — the single most
 * common glyph on the starter rows.
 *
 * These two tests make that class of drift a CI failure rather than a
 * code-review responsibility:
 *
 *   1. BIJECTION — the set of marks the RENDERER can put in the DOM equals the
 *      set the LEGEND documents, in both directions.
 *   2. NO EMOJI — no mark in the vocabulary is an Emoji code point, because an
 *      Emoji-presentation glyph is drawn from the colour-emoji font and
 *      silently IGNORES every CSS colour the component asks for. This is the
 *      test that would have caught `🚫`, `⚡` and `⏱` on the day each landed;
 *      a reviewer cannot see from a diff that `text-indigo-300` will never
 *      apply.
 */

import { describe, it, expect } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import { GLYPHS, GLYPH_LIST, GLYPH_MARKS } from "@/lib/glyphs";
import { AdaptiveLegend } from "@/components/adaptive-legend";
import { DepthChip } from "@/components/depth-chip";
import { StatusChip, Badge } from "@/components/badges";
import { buildStarterBadge } from "@/lib/live-status";
import type { Overlay } from "@/lib/overlay-types";

const ALL_OVERLAYS = new Set<Overlay>([
  "links",
  "depth",
  "health",
  "parity",
  "docs",
  "d6",
]);

/**
 * The legend is CLOSED by default (it is fixed-position and was covering the
 * bottom rows of the grid). Every contract assertion below is about what the
 * legend DOCUMENTS, so open it the way a reader does — one click on the
 * toggle — rather than reaching past the component with a test-only prop.
 */
function renderOpenLegend(): HTMLElement {
  const { container } = render(<AdaptiveLegend overlays={ALL_OVERLAYS} />);
  fireEvent.click(within(container).getByRole("button", { name: /legend/i }));
  return container;
}

/**
 * The marks a rendered tree DOCUMENTS, read from the `data-glyph` attribute
 * that `StatusChip`/`GlyphMark` stamp on every vocabulary glyph.
 *
 * Deliberately NOT a textContent scan: the legend prose legitimately contains
 * `—` as a separator and `?` in ordinary sentences, so a text scan reports a
 * glyph as "documented" even after its legend row is deleted. That exact false
 * negative was caught by mutation-testing this file (dropping the `gated` row
 * left the suite green); reading the attribute makes the row itself the
 * evidence.
 */
function marksIn(container: HTMLElement): Set<string> {
  const found = new Set<string>();
  for (const el of container.querySelectorAll("[data-glyph]")) {
    const id = el.getAttribute("data-glyph");
    const spec = GLYPH_LIST.find((g) => g.id === id);
    if (spec) found.add(spec.mark);
  }
  return found;
}

/**
 * Every place a status glyph reaches the DOM, rendered IN ISOLATION so the
 * node's entire text content IS the mark. That exactness is the point: it makes
 * the assertion "this site emits a mark from the vocabulary" — which catches a
 * site emitting something the vocabulary has never heard of — rather than the
 * weaker "the vocabulary marks it emits are documented", which a mark outside
 * the vocabulary would slip straight past.
 */
function emitSites(): { site: string; label: string }[] {
  const out: { site: string; label: string }[] = [];
  const emit = (site: string, ui: React.ReactElement, strip = ""): void => {
    const { container } = render(ui);
    const label = (container.textContent ?? "").replace(strip, "").trim();
    out.push({ site, label });
    cleanup();
  };

  // --- depth chip, every non-depth branch ----------------------------------
  emit(
    "depth-chip:unreachable",
    <DepthChip depth={0} status="wired" unreachable />,
  );
  emit(
    "depth-chip:pending-no-prior",
    <DepthChip depth={0} status="wired" pending />,
  );
  emit("depth-chip:unshipped", <DepthChip depth={0} status="unshipped" />);
  emit("depth-chip:unsupported", <DepthChip depth={0} status="unsupported" />);

  // --- per-rung bare marks (unified-cell's TestBadge routes through Badge) --
  for (const level of [
    { status: "green" as const },
    { status: "red" as const },
    { status: "amber" as const },
    { status: null },
  ]) {
    emit(
      `rung:${level.status ?? "no-data"}`,
      <TestBadgeProbe name="UI" status={level.status} />,
      "UI",
    );
  }
  emit("rung:gated", <TestBadgeProbe name="D6" status={null} gated />, "D6");

  // --- feature-grid whole-cell states --------------------------------------
  emit(
    "feature-grid:not-supported",
    <StatusChip tone="gray" label={GLYPHS.notSupported.mark} />,
  );
  emit(
    "feature-grid:not-shipped",
    <StatusChip tone="gray" label={GLYPHS.notShipped.mark} />,
  );

  // --- the starter label builder, exercised for real -----------------------
  const now = Date.now();
  for (const support of ["unsupported", "unprobed", "probed"] as const) {
    out.push({
      site: `buildStarterBadge:${support}`,
      label: buildStarterBadge("health", support, null, now, "live").label,
    });
  }
  for (const state of ["green", "degraded", "red"] as const) {
    out.push({
      site: `buildStarterBadge:${state}`,
      label: buildStarterBadge(
        "agent",
        "probed",
        {
          key: "starter:x/agent",
          state,
          observed_at: new Date(now).toISOString(),
          fail_count: 0,
        } as never,
        now,
        "live",
      ).label,
    });
  }

  return out;
}

/** Thin stand-in for `unified-cell`'s TestBadge, which is not exported. */
function TestBadgeProbe({
  name,
  status,
  gated = false,
}: {
  name: string;
  status: "green" | "red" | "amber" | null;
  gated?: boolean;
}) {
  const label = gated
    ? GLYPHS.gated.mark
    : status === "green"
      ? GLYPHS.pass.mark
      : status === "red"
        ? GLYPHS.fail.mark
        : status === "amber"
          ? GLYPHS.degraded.mark
          : GLYPHS.noData.mark;
  const tone =
    gated || status === null
      ? ("gray" as const)
      : status === "green"
        ? ("green" as const)
        : status === "red"
          ? ("red" as const)
          : ("amber" as const);
  return <Badge name={name} state={{ tone, label }} />;
}

function marksTheRendererCanEmit(): Set<string> {
  return new Set(emitSites().map((e) => e.label));
}

describe("glyph vocabulary ↔ legend bijection", () => {
  it("every emit site emits a mark that IS in the vocabulary", () => {
    const strays = emitSites().filter((e) => !GLYPH_MARKS.includes(e.label));
    expect(
      strays,
      `these render sites emit a mark the vocabulary has never heard of — add it to GLYPHS in showcase/harness/src/shared/cell-model/glyphs.ts, or use an existing mark: ${JSON.stringify(strays)}`,
    ).toEqual([]);
  });

  it("every mark the renderer can emit is documented by the legend", () => {
    const emitted = marksTheRendererCanEmit();
    const container = renderOpenLegend();
    const documented = marksIn(container);

    const undocumented = [...emitted].filter((m) => !documented.has(m));
    expect(
      undocumented,
      `the renderer emits ${JSON.stringify(undocumented)} but the legend documents none of it`,
    ).toEqual([]);
  });

  it("every mark the legend documents is actually emitted by the renderer", () => {
    const emitted = marksTheRendererCanEmit();
    const container = renderOpenLegend();
    const documented = marksIn(container);

    const unemitted = [...documented].filter((m) => !emitted.has(m));
    expect(
      unemitted,
      `the legend documents ${JSON.stringify(unemitted)} but nothing emits it — a dead legend entry is how the previous legend came to claim "✗ = not supported"`,
    ).toEqual([]);
  });

  it("the legend renders exactly the vocabulary, no more and no less", () => {
    const container = renderOpenLegend();
    expect([...marksIn(container)].sort()).toEqual([...GLYPH_MARKS].sort());
  });

  it("every vocabulary mark is unique", () => {
    expect(new Set(GLYPH_MARKS).size).toBe(GLYPH_MARKS.length);
  });

  it("green, amber and red are VERDICT-only tones", () => {
    const verdictTones = new Set(["ok", "amber", "danger"]);
    const offenders = GLYPH_LIST.filter(
      (g) => g.glyphClass === "absence" && verdictTones.has(g.tone),
    ).map((g) => g.id);
    expect(
      offenders,
      "an absence must never wear a verdict colour — amber means 'judged and degraded', and an infrastructure failure is not a verdict",
    ).toEqual([]);
  });
});

describe("no Emoji code points in the vocabulary", () => {
  // The trap is WIDER than Emoji_Presentation: `✔` (U+2714) and `✖` (U+2716)
  // are Emoji=Yes / Emoji_Presentation=No, so they render as text *usually*
  // and can be emoji-presented with VS16 or on some platform font stacks.
  // `\p{Extended_Pictographic}` catches that whole family (and `🚫`, `⚡`,
  // `⏱`) while — unlike a bare `\p{Emoji}` — NOT matching digits, `#` or `*`.
  const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
  const VARIATION_SELECTOR = /[︎️]/u;

  it.each(GLYPH_LIST.map((g) => [g.id, g.mark] as const))(
    "%s (%s) is text-presentation, so CSS colour actually applies",
    (id, mark) => {
      for (const cp of mark) {
        expect(
          PICTOGRAPHIC.test(cp),
          `${id}: U+${cp.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")} is Extended_Pictographic — the browser will draw it from the colour-emoji font and IGNORE every text-* class on it`,
        ).toBe(false);
      }
      expect(VARIATION_SELECTOR.test(mark)).toBe(false);
    },
  );

  it("catches the three glyphs this dashboard actually shipped", () => {
    // Positive control: the ban must fire on the real historical offenders,
    // otherwise a green run proves nothing.
    for (const emoji of ["\u{1F6AB}", "⚡", "⏱"]) {
      expect(PICTOGRAPHIC.test(emoji)).toBe(true);
    }
    // And must NOT fire on the marks we chose instead.
    for (const ok of [
      GLYPHS.pass.mark,
      GLYPHS.fail.mark,
      GLYPHS.requeued.mark,
    ]) {
      expect(PICTOGRAPHIC.test(ok)).toBe(false);
    }
  });
});
