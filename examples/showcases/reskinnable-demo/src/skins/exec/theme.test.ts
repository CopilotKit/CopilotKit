/**
 * Contrast guard for Vantage's token values.
 *
 * WHY THIS EXISTS. A skin owns only the VALUES behind the shell's shared token
 * names, and the dark block re-values one side of a pair at a time. That is
 * exactly how a foreground/background pair silently loses its contrast: lifting
 * `--brand` for a dark ground FLIPS the polarity of every pair the brand
 * anchors, and nothing else in this repo notices. A failing pair still
 * type-checks, still lints, still renders, and still passes every other unit
 * test — the chip is simply unreadable.
 *
 * Exec is dark-capable (`--nw-dark-capable: 1`), so it ships TWO sets of values
 * and needs the guard twice over. It shipped without one, and four pairs were
 * below the bar the sibling skins already codify:
 *
 *   - light `--brand` on `--brand-soft`      2.71:1  (active nav, status chips,
 *                                                     metrics filter, the shell
 *                                                     selector card)
 *   - light `--positive` on `--positive-soft` 3.55:1 (green status chips)
 *   - light `--positive` on `--surface`       3.90:1 (deltas, "Pinned ✓")
 *   - dark  `--negative` on `--surface`       4.31:1 (every error line, incl.
 *                                                     the inline block card)
 *   - dark  `--negative` on `--negative-soft` 3.82:1 (error banners)
 *   - dark  `--brand-violet` on `--brand-soft` 3.91:1 (the shared chrome's
 *                                                     dark-mode ink on brand-soft)
 *
 * The brand pair could not be fixed by nudging one token: with a DARK
 * `--brand-foreground`, `--brand-foreground`-on-`--brand` and
 * `--brand`-on-`--brand-soft` pull in opposite directions and 4.5:1 on both is
 * arithmetically impossible (a brand dark enough for a near-white soft needs a
 * ground lighter than white to carry it). So the light block now follows the
 * same shape as every other skin: a DEEP brand fill under a white
 * `--brand-foreground`, with the dark block re-valuing both.
 *
 * The file is parsed rather than imported because CSS custom properties are not
 * a module: reading the real declarations is what makes this a guard on the
 * shipped values and not a restatement of them.
 *
 * Sites are DERIVED, not hand-written. Each pair carries the class-pair pattern
 * that renders it, the test greps for it, prints the line numbers it found, and
 * FAILS when a pattern finds nothing — a `file:line` written by hand rots, and a
 * pair whose render site disappeared would otherwise sit here looking like
 * coverage. Tinted grounds (`bg-*-soft/40`) are COMPOSITED before measuring, for
 * the same reason: measuring against the card under a tint reports a ratio the
 * user never sees.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const THEME_CSS = path.join(__dirname, "theme.css");
/** `src/`, so a site can name a shell file as well as one of this skin's. */
const SRC_ROOT = path.join(__dirname, "..", "..");

/** An `H S% L%` token value, as `--brand: 43 62% 30%` declares it. */
type Hsl = readonly [h: number, s: number, l: number];

function hslToRgb([h, s, l]: Hsl): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = light - c / 2;
  return [r + m, g + m, b + m];
}

/** An `r g b` triple in 0…1, which is what a composited ground is. */
type Rgb = readonly [number, number, number];

/** WCAG 2.x relative luminance. */
function relativeLuminance(colour: Rgb): number {
  const [r, g, b] = colour.map((channel) =>
    channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two opaque colours, 1:1 … 21:1. */
function ratioRgb(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.x contrast ratio, 1:1 … 21:1. */
export function contrastRatio(a: Hsl, b: Hsl): number {
  return ratioRgb(hslToRgb(a), hslToRgb(b));
}

/**
 * `hsl(var(--x) / a)` over an opaque ground, i.e. what the browser actually
 * paints for a Tailwind `bg-<token>/<alpha>` utility. Text on a tinted row reads
 * against THIS, not against whatever the row would otherwise have been.
 */
export function composite(tint: Hsl, base: Hsl, alpha: number): Rgb {
  const [tr, tg, tb] = hslToRgb(tint);
  const [br, bg, bb] = hslToRgb(base);
  const mix = (t: number, b: number) => alpha * t + (1 - alpha) * b;
  return [mix(tr, br), mix(tg, bg), mix(tb, bb)];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Pull the `H S% L%` declarations out of one rule body. Only triplet-valued
 * tokens are collected — `--radius`, `color-scheme` and the dark-capable flag
 * are not colours and are deliberately skipped.
 *
 * The selector is anchored to the START OF A LINE and required to match EXACTLY
 * once, because `indexOf(".theme-exec {")` would also find `.dark .theme-exec {`
 * and reordering `theme.css` would then silently retarget every light-mode
 * assertion at the dark block.
 */
export function parseRule(css: string, selector: string): Record<string, Hsl> {
  const opens = [
    ...css.matchAll(new RegExp(`^${escapeRe(selector)}\\s*\\{`, "gm")),
  ];
  if (opens.length !== 1) {
    throw new Error(
      `theme.css must declare \`${selector}\` exactly once at the start of a line; found ${opens.length}`,
    );
  }
  const open = css.indexOf("{", opens[0].index);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);
  if (body.includes("{")) {
    throw new Error(
      `\`${selector}\` has a nested block; this parser only reads flat rule bodies`,
    );
  }

  const tokens: Record<string, Hsl> = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const hsl = value.trim().match(/^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
    if (hsl) tokens[name] = [Number(hsl[1]), Number(hsl[2]), Number(hsl[3])];
  }
  return tokens;
}

const css = readFileSync(THEME_CSS, "utf8");
const lightTokens = parseRule(css, ".theme-exec");
const darkOverrides = parseRule(css, ".dark .theme-exec");
/** `.dark` is an ancestor of the theme root, so dark INHERITS what it omits. */
const darkTokens = { ...lightTokens, ...darkOverrides };

/**
 * Where a pair is rendered, as the CLASS PAIR that renders it rather than a
 * line number. Grepped at test time, so the citation cannot rot and an assertion
 * whose render site disappears fails instead of quietly guarding nothing.
 */
type Site = { readonly file: string; readonly pattern: RegExp };

const lineAt = (text: string, index: number) =>
  text.slice(0, index).split("\n").length;

/** `file:line` for every match of every pattern, in file order. */
function findSites(sites: readonly Site[]): string[] {
  return sites.flatMap(({ file, pattern }) => {
    const text = readFileSync(path.join(SRC_ROOT, file), "utf8");
    const re = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    return [...text.matchAll(re)].map(
      (m) => `${file}:${lineAt(text, m.index)}`,
    );
  });
}

/**
 * The pairs that carry TEXT in this skin. 4.5:1 is the bar for all of them:
 * every label listed here is normal-size text (the primary buttons are
 * `text-xs font-medium`, the status chips `text-[0.6rem]`, the largest is the
 * `text-sm` delta — all far under the 18.66px/bold cut-off that would let 3:1
 * apply).
 *
 * `bg` is the ground the text is actually PAINTED ON. When that ground is a
 * Tailwind alpha tint (`bg-negative-soft/40`), give `alpha` + `over` so the
 * ground is composited first.
 */
type Pair = {
  readonly fg: string;
  readonly bg: {
    readonly token: string;
    /** Set together: `token` at `alpha` composited over `over`. */
    readonly alpha?: number;
    readonly over?: string;
  };
  /** What renders it, in prose. Line numbers come from `sites`, never from here. */
  readonly label: string;
  /** Class-pair patterns that locate the render sites. Omitted for diffuse pairs. */
  readonly sites?: readonly Site[];
  /** Omitted = asserted in both modes. Set when only one mode renders it. */
  readonly modes?: ReadonlyArray<"light" | "dark">;
};

const EXEC = "skins/exec";

/**
 * The three RYG initiative rows are `bg-surface` overridden by
 * `bg-<tone>-soft/40` — `cn()`/tailwind-merge keeps the LAST background-color,
 * so the 40% tone tint composites over the page ground (`bg-canvas`, set on the
 * shell frame in `skins/exec/layout.tsx`), not over the card that never paints.
 */
const RYG_WASH_OVER = "--canvas";

const TEXT_PAIRS: readonly Pair[] = [
  {
    fg: "--brand-foreground",
    bg: { token: "--brand" },
    label: "every primary button (`bg-brand text-brand-foreground`)",
    sites: [`${EXEC}/tools.tsx`, `${EXEC}/pages/board-packs.tsx`].map(
      (file) => ({
        file,
        pattern: /\bbg-brand\b[^"]*\btext-brand-foreground\b/,
      }),
    ),
  },
  {
    // 2.71:1 in light before this guard: the single worst pair in the skin, and
    // the one the whole light-block reshape was for.
    fg: "--brand",
    bg: { token: "--brand-soft" },
    label:
      "the active nav item, the metric `Breach` chip, the amber initiative pill, the metrics-explorer filter, the shell selector card",
    sites: [
      `${EXEC}/layout.tsx`,
      `${EXEC}/catalog/renderers.tsx`,
      `${EXEC}/pages/ceo-dashboard.tsx`,
      `${EXEC}/pages/metrics-explorer.tsx`,
      "shell/layout/selector-card.tsx",
    ].map((file) => ({
      file,
      pattern: /\bbg-brand-soft\b[^"]*\btext-brand(?![\w-])/,
    })),
  },
  {
    // DARK ONLY — the shared chrome inks brand-soft with `text-brand-indigo` in
    // light and reaches for `--brand-violet` exclusively behind a `dark:`
    // variant, so a light-mode assertion here would guard a combination that
    // never renders. The pattern encodes exactly that: a brand-soft ground and a
    // `dark:`-gated pewter label on the same element.
    fg: "--brand-violet",
    bg: { token: "--brand-soft" },
    modes: ["dark"],
    label:
      "shared chrome's dark pewter on brand-soft: dropdown/select focus rows, avatar initials, secondary + ghost button labels",
    sites: [
      "components/ui/dropdown-menu.tsx",
      "components/ui/select.tsx",
      "components/ui/avatar.tsx",
      "components/ui/button.tsx",
    ].map((file) => ({
      file,
      pattern: /\bbg-brand-soft\b[^"]*\bdark:(?:\w+:)?text-brand-violet\b/,
    })),
  },
  {
    fg: "--positive",
    bg: { token: "--positive-soft" },
    label: "the green initiative status pill on both dashboards",
    sites: [
      `${EXEC}/catalog/renderers.tsx`,
      `${EXEC}/pages/ceo-dashboard.tsx`,
    ].map((file) => ({
      file,
      pattern: /\bbg-positive-soft\b[^"]*\btext-positive\b/,
    })),
  },
  {
    // `--surface` is the ground because every one of these renders inside a
    // `bg-surface` container: the catalog `Tile`, the shell's inline block card
    // (`shell/chat/inline-block-surface.tsx`) and the board-pack panel. There is
    // no static way to assert where a component is MOUNTED, so the pattern
    // locates the ink and this note records the ground.
    fg: "--positive",
    bg: { token: "--surface" },
    label:
      "the up-delta glyph on a metric tile, the `Pinned ✓` confirmation, a positive board-pack note",
    sites: [
      {
        file: `${EXEC}/catalog/renderers.tsx`,
        pattern: /text-sm font-medium text-positive\b/,
      },
      {
        file: `${EXEC}/pages/board-packs.tsx`,
        pattern: /"positive" && "text-positive"/,
      },
    ],
  },
  {
    // Same ground, and the one the dark block was failing: 4.31:1.
    fg: "--negative",
    bg: { token: "--surface" },
    label:
      "every error line on a card — the dashboard grid's render/A2UI errors, the breaching metric row, the CEO exception variance",
    sites: [
      {
        file: `${EXEC}/components/dashboard-grid.tsx`,
        pattern: /\bbg-surface\b[^"]*\btext-negative\b/,
      },
    ],
  },
  {
    fg: "--negative",
    bg: { token: "--negative-soft" },
    label:
      "the red initiative pill, the missing-tile banner, the ledger's failure banner",
    sites: [
      `${EXEC}/catalog/renderers.tsx`,
      `${EXEC}/pages/ceo-dashboard.tsx`,
      `${EXEC}/data/ledger-context.tsx`,
    ].map((file) => ({
      file,
      pattern: /\bbg-negative-soft\b[^"]*\btext-negative\b/,
    })),
  },
  // The RYG initiative rows: ink on a 40% tone wash. Composited, per the header.
  ...(["negative", "brand", "positive"] as const).map((tone) => ({
    fg: "--ink",
    bg: { token: `--${tone}-soft`, alpha: 0.4, over: RYG_WASH_OVER },
    label: `the initiative name on a ${tone} RYG row`,
    sites: [
      {
        file: `${EXEC}/pages/ceo-dashboard.tsx`,
        pattern: new RegExp(`bg-${tone}-soft/40`),
      },
    ],
  })),
  // Diffuse pairs: no single render site to cite, so none is claimed.
  { fg: "--ink", bg: { token: "--surface" }, label: "every card body" },
  {
    fg: "--ink-muted",
    bg: { token: "--surface" },
    label: "every label and hint",
  },
  { fg: "--ink", bg: { token: "--canvas" }, label: "page background" },
  { fg: "--ink-muted", bg: { token: "--canvas" }, label: "page background" },
  {
    fg: "--ink-muted",
    bg: { token: "--surface-muted" },
    label: "the empty-state panels on both dashboards",
  },
  { fg: "--foreground", bg: { token: "--background" }, label: "document root" },
];

/*
 * DELIBERATE EXCLUSIONS, so the list above is not read as "everything passes".
 * Each was measured; neither is this file's to fix:
 *
 * - `--brand-indigo` on `--brand-soft`: 9.17:1 light, 2.66:1 dark. The dark
 *   failure is SHELL-WIDE — `--brand-indigo` on `--brand-soft` fails in dark in
 *   every dark-capable skin (banking 2.75, commerce 2.70, keel 1.21, logistics
 *   2.43, people 2.62) — which is why the shared chrome mostly pairs brand-soft
 *   with a `dark:`-gated `--brand-violet` ink instead, the pair asserted above.
 *   `skins/commerce/theme.test.ts` already DERIVES the un-overridden shared-chrome
 *   holdouts and fails when that set changes; duplicating that scan per skin
 *   would give five copies of one shell-wide guard, so it is deliberately not
 *   repeated here. This skin's own `tools.tsx` holdout is being given a
 *   `dark:text-brand-violet` counterpart separately.
 * - `--brand` as a BORDER or ring (`border-brand/50`, `border-l-brand`,
 *   `focus-visible:ring-brand`) is a graphic boundary at 3:1 under WCAG 1.4.11,
 *   not text. Deepening `--brand` for the pair above only improved these, so no
 *   assertion is claimed for a bar nothing was near.
 * - `--ink-muted` on the RYG washes: the "Explained/Unexplained" and status
 *   captions. Measured with the same compositor and clearing 4.5:1 in both
 *   modes; not listed separately because `--ink` on the same three grounds is
 *   the stricter, already-asserted case only where ink is DARKER than muted,
 *   which is both modes here.
 */

const AA_NORMAL_TEXT = 4.5;

/** Resolve a pair's ground in one mode, compositing an alpha tint if declared. */
function groundOf(pair: Pair, tokens: Record<string, Hsl>): Rgb | undefined {
  const { token, alpha, over } = pair.bg;
  const tint = tokens[token];
  if (!tint) return undefined;
  if (alpha === undefined || over === undefined) return hslToRgb(tint);
  const base = tokens[over];
  return base ? composite(tint, base, alpha) : undefined;
}

/** How the ground reads in a test name and a failure message. */
const groundName = ({ bg }: Pair) =>
  bg.alpha === undefined
    ? bg.token
    : `${bg.token}/${Math.round(bg.alpha * 100)} over ${bg.over}`;

describe("Vantage theme.css contrast", () => {
  for (const [mode, tokens] of [
    ["light", lightTokens],
    ["dark", darkTokens],
  ] as const) {
    describe(mode, () => {
      for (const pair of TEXT_PAIRS) {
        const { fg, modes, label } = pair;
        if (modes && !modes.includes(mode)) continue;
        const bg = groundName(pair);
        it(`${fg} on ${bg} clears WCAG AA for normal text (${label})`, () => {
          const foreground = tokens[fg];
          expect(foreground, `${fg} is not declared`).toBeDefined();
          const background = groundOf(pair, tokens);
          expect(background, `${bg} is not declared`).toBeDefined();

          const ratio = ratioRgb(hslToRgb(foreground), background!);
          expect(
            ratio,
            `${mode}: ${fg} (${foreground.join(" ")}) on ${bg} is ` +
              `${ratio.toFixed(2)}:1, below ${AA_NORMAL_TEXT}:1`,
          ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        });
      }
    });
  }

  describe("the pairs are the pairs that render", () => {
    // A pair whose class pair no longer appears anywhere is guarding a
    // combination the app does not paint, and must fail rather than keep
    // passing. The located lines are printed so the next reader can go and look.
    for (const pair of TEXT_PAIRS) {
      if (!pair.sites) continue;
      it(`still renders ${pair.fg} on ${groundName(pair)} somewhere`, () => {
        const found = findSites(pair.sites!);
        expect(
          found,
          `no source matches the class pair for ${pair.fg} on ${groundName(pair)} — ` +
            `either the pattern is wrong or this pair no longer renders`,
        ).not.toEqual([]);
        console.info(`${pair.fg} on ${groundName(pair)}: ${found.join(", ")}`);
      });
    }
  });

  it("reads the light block even if theme.css is reordered", () => {
    // `indexOf(".theme-exec {")` also matches inside `.dark .theme-exec {`, so
    // with the dark rule first every light assertion would silently move to the
    // dark block. Anchoring to a line start is what makes the lookup
    // positional-independent; this proves it on a reordered file, not on ours.
    const reordered = [
      ".dark .theme-exec {",
      "  --brand: 1 1% 1%;",
      "}",
      ".theme-exec {",
      "  --brand: 2 2% 2%;",
      "}",
    ].join("\n");
    expect(parseRule(reordered, ".theme-exec")["--brand"]).toEqual([2, 2, 2]);
    expect(parseRule(reordered, ".dark .theme-exec")["--brand"]).toEqual([
      1, 1, 1,
    ]);
  });

  it("composites an alpha tint the way a browser paints it", () => {
    // Fully opaque and fully transparent are the two ends the compositor must
    // agree with, or every tinted ground above is measured against the wrong
    // colour.
    const brass: Hsl = [43, 62, 30];
    const white: Hsl = [0, 0, 100];
    expect(composite(brass, white, 1)).toEqual(hslToRgb(brass));
    expect(composite(brass, white, 0)).toEqual(hslToRgb(white));
    // A tint of a colour over a LIGHTER base always reduces that colour's own
    // contrast against the ground it sits on.
    expect(
      ratioRgb(hslToRgb(brass), composite(brass, white, 0.4)),
    ).toBeLessThan(contrastRatio(brass, white));
  });

  it("re-values --brand-foreground in dark, because dark re-values --brand", () => {
    // The regression this whole file exists for: a block that moves the brand
    // fill and leaves the label colour behind. Light runs a DEEP brass under a
    // white label; dark runs a lifted brass under a deep one. Asserting the
    // OVERRIDE is present (not merely that the ratio happens to pass) is what
    // stops the pairing from silently drifting apart again.
    expect(darkOverrides["--brand"]).toBeDefined();
    expect(darkOverrides["--brand-foreground"]).toBeDefined();
  });

  it("re-values every brand-ramp token the dark block's comment claims", () => {
    // The header of `.dark .theme-exec` used to say only `--brand` and
    // `--brand-soft` were re-valued while the block also moved `--brand-indigo`
    // and `--brand-violet` — a comment that under-reports what a block does is
    // how a reader concludes a token is safe to reason about from the light
    // value alone. Derived here so the prose cannot drift from the rule again.
    expect(
      Object.keys(darkOverrides)
        .filter((name) => name.startsWith("--brand"))
        .sort(),
    ).toEqual([
      "--brand",
      "--brand-foreground",
      "--brand-indigo",
      "--brand-soft",
      "--brand-violet",
    ]);
  });

  it("keeps the calculator honest against known WCAG values", () => {
    // Black on white is exactly 21:1; a colour against itself is exactly 1:1.
    expect(contrastRatio([0, 0, 0], [0, 0, 100])).toBeCloseTo(21, 5);
    expect(contrastRatio([43, 62, 30], [43, 62, 30])).toBeCloseTo(1, 5);
    // #767676 on white is the canonical 4.54:1 AA boundary grey.
    expect(contrastRatio([0, 0, 46.3], [0, 0, 100])).toBeCloseTo(4.54, 1);
  });
});
