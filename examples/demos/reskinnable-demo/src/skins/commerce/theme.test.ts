/**
 * Contrast guard for Bellwether's token values.
 *
 * WHY THIS EXISTS. A skin owns only the VALUES behind the shell's shared token
 * names, and the dark block re-values one side of a pair at a time. That is
 * exactly how a foreground/background pair silently loses its contrast: lifting
 * `--brand` for a dark ground FLIPS the polarity of every pair the brand
 * anchors, and nothing else in this repo notices. A failing pair still
 * type-checks, still lints, still renders, and still passes every other unit
 * test — the button is simply unreadable. So the ratios are computed here,
 * straight out of `theme.css`, and asserted.
 *
 * The file is parsed rather than imported because CSS custom properties are not
 * a module: reading the real declarations is what makes this a guard on the
 * shipped values and not a restatement of them.
 *
 * ── TWO WAYS THIS GUARD ITSELF WAS WRONG, both fixed here ────────────────────
 *
 * A contrast guard is only as good as the BACKGROUND it names, and a green check
 * on the wrong ground actively suppresses investigation. Both of these shipped:
 *
 *  1. **It measured the wrong ground.** `--brand-violet` was asserted against
 *     `--surface` and cited the markdown Pill as the thing that renders it — but
 *     that Pill is `bg-brand-violet/12 text-brand-violet`, so the rose reads
 *     against a 12% wash of ITSELF over the card, which is darker than the card.
 *     The card said 4.52:1 (pass); the real ground said 3.75:1 (fail). Hence
 *     `bg.alpha`/`bg.over` below: a tinted ground is COMPOSITED before measuring.
 *  2. **Its citations rotted, so nothing could be checked.** Every `file:line`
 *     was hand-written and every one of them was stale — the reader could not
 *     find the site an assertion claimed to be about, which is how (1) survived.
 *     Sites are now DERIVED: each pair carries the class-pair pattern that
 *     renders it, the test greps for it, prints the line numbers it found, and
 *     FAILS when a pattern finds nothing. A pair whose render site disappears can
 *     no longer sit here looking like coverage.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const THEME_CSS = path.join(__dirname, "theme.css");
/** `src/`, so a site can name a shell file as well as one of this skin's. */
const SRC_ROOT = path.join(__dirname, "..", "..");

/** An `H S% L%` token value, as `--brand: 202 76% 58%` declares it. */
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
 * paints for a Tailwind `bg-<token>/<alpha>` utility. Text on a tinted chip reads
 * against THIS, not against the card underneath it.
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
 * once. An `indexOf(".theme-commerce {")` here used to find `.dark
 * .theme-commerce {` as well, so reordering `theme.css` would silently retarget
 * every light-mode assertion at the dark block — a guard that reports on a
 * different rule than the one it names is worse than no guard.
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
const lightTokens = parseRule(css, ".theme-commerce");
const darkOverrides = parseRule(css, ".dark .theme-commerce");
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
 * The pairs that carry TEXT in this skin. 4.5:1 is the bar for all of them: every
 * label listed here is normal-size text (the primary buttons are
 * `text-[0.75rem] font-semibold`, which is well under the 18.66px/bold cut-off
 * that would let 3:1 apply).
 *
 * `bg` is the ground the text is actually PAINTED ON. When that ground is a
 * Tailwind alpha tint (`bg-brand-violet/12`), give `alpha` + `over` so the ground
 * is composited first — measuring against the card underneath a tint reports a
 * ratio the user never sees, and reported it as a pass.
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

const COMMERCE = "skins/commerce";

const TEXT_PAIRS: readonly Pair[] = [
  {
    fg: "--brand-foreground",
    bg: { token: "--brand" },
    label: "every primary button (`bg-brand text-brand-foreground`)",
    sites: [
      `${COMMERCE}/tools.tsx`,
      `${COMMERCE}/pages/promotions.tsx`,
      `${COMMERCE}/pages/returns.tsx`,
    ].map((file) => ({
      file,
      pattern: /\bbg-brand\b[^"]*\btext-brand-foreground\b/,
    })),
  },
  {
    fg: "--brand",
    bg: { token: "--brand-soft" },
    label: "brand pills, the active nav item, agent-set filter/sort controls",
    sites: [
      `${COMMERCE}/components/primitives.tsx`,
      `${COMMERCE}/layout.tsx`,
      "shell/layout/selector-card.tsx",
    ].map((file) => ({
      file,
      pattern: /\bbg-brand-soft\b[^"]*\btext-brand(?![\w-])/,
    })),
  },
  {
    // DARK ONLY — every one of these sites pairs brand-soft with
    // `text-brand-indigo` in light mode and reaches for the rose exclusively
    // behind a `dark:` variant, so a light-mode assertion here would guard a
    // combination that never renders. The pattern encodes exactly that: a
    // brand-soft ground and a `dark:`-gated rose label on the same element.
    fg: "--brand-violet",
    bg: { token: "--brand-soft" },
    modes: ["dark"],
    label:
      "shared chrome's dark rose on brand-soft: dropdown/select focus rows, avatar initials, secondary + ghost button labels",
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
    // The markdown Pill. Its ground is a 12% wash of the rose over the card, NOT
    // the card: this is the pair the old card-only assertion mis-measured as
    // 4.52:1 when the rendered ratio was 3.75:1.
    fg: "--brand-violet",
    bg: { token: "--brand-violet", alpha: 0.12, over: "--surface" },
    label:
      "the markdown Pill — `bg-brand-violet/12 text-brand-violet` at text-[0.68rem], on a bg-surface Panel",
    sites: [
      {
        file: `${COMMERCE}/components/primitives.tsx`,
        pattern: /bg-brand-violet\/12[^"]*text-brand-violet\b/,
      },
    ],
  },
  {
    // The rose on the bare card: the small markdown figure on a promotions row.
    // (`Metric`'s markdown figure is `text-xl font-semibold`, i.e. WCAG large
    // text at 3:1, so this 4.5:1 bar is set by this small use.)
    fg: "--brand-violet",
    bg: { token: "--surface" },
    label: "the small markdown price figure on a promotions row",
    sites: [
      {
        file: `${COMMERCE}/pages/promotions.tsx`,
        pattern: /font-medium text-brand-violet\b/,
      },
    ],
  },
  {
    // The "why" slot on the margin-summary tool card: ink on a 10% rose wash.
    fg: "--ink",
    bg: { token: "--brand-violet", alpha: 0.1, over: "--surface" },
    label: "the rose `why` note on a tool card",
    sites: [
      {
        file: `${COMMERCE}/tools.tsx`,
        pattern: /bg-brand-violet\/10[^"]*text-ink\b/,
      },
    ],
  },
  // Diffuse pairs: no single render site to cite, so none is claimed.
  { fg: "--ink", bg: { token: "--surface" }, label: "every card body" },
  {
    fg: "--ink-muted",
    bg: { token: "--surface" },
    label: "every label and hint",
  },
  { fg: "--ink", bg: { token: "--canvas" }, label: "page background" },
  { fg: "--ink-muted", bg: { token: "--canvas" }, label: "page background" },
  { fg: "--foreground", bg: { token: "--background" }, label: "document root" },
];

/*
 * DELIBERATE EXCLUSIONS, so the list above is not read as "everything passes".
 * Each of these was measured and each is a pre-existing, TWO-sided choice rather
 * than the one-sided dark override this guard is about:
 *
 * - `--positive` on `--positive-soft`: 4.12:1 light, 5.47:1 dark.
 * - `--negative` on `--negative-soft`: 4.41:1 light, 4.33:1 dark.
 *   Both tone-chip pairs are short of 4.5:1 in LIGHT mode too, i.e. they are not
 *   a dark-mode regression, and the same treatment is short in every skin.
 *   Moving them is a palette decision across the set, not a fix to this file.
 * - `--brand-indigo` on `--brand-soft`: 11.10:1 light, 2.70:1 dark. Fails in
 *   dark in EVERY dark-capable skin (banking 2.75, keel 1.21, logistics 2.43,
 *   people 2.62), which is why the shared chrome MOSTLY pairs brand-soft with a
 *   `dark:`-gated `--brand-violet` ink instead — the pair asserted above. It does
 *   NOT do so everywhere, and the un-overridden remainder INCLUDES REAL TEXT:
 *   `button.tsx`'s `outline` variant re-inks its LABEL to `--brand-indigo` on
 *   hover with no dark counterpart. An earlier version of this note claimed the
 *   override was applied "at every text site" and that the sole holdout was a
 *   non-text icon hover; both halves were false, and the wrong half was the
 *   reassuring one. The holdouts are therefore no longer described in prose:
 *   `UN_OVERRIDDEN_BRAND_SOFT_INK` below names them, and a test derives the real
 *   set from the shared chrome and fails if it grows OR if a listed one is fixed.
 *   Correcting them is still shell-wide work (five skins paint these) and out of
 *   this skin's reach — but the gap is now recorded rather than denied.
 * - `Metric`'s markdown figure (`text-xl font-semibold text-brand-violet` on
 *   `--surface-muted`) is WCAG LARGE text, so its bar is 3:1. It measures 5.42:1
 *   light / 6.02:1 dark, i.e. it also clears the stricter bar — it is listed here
 *   rather than asserted because the bar that applies to it is not this file's.
 * - The markdown Pill is only ever mounted inside a `bg-surface` Panel
 *   (pages/promotions.tsx, catalog/renderers.tsx). Its wash over the two other
 *   grounds would be 4.31:1 (`--surface-muted`) and 4.13:1 (`--canvas`), so
 *   moving it onto a muted panel WOULD need the rose deepened again. There is no
 *   static way to assert where a component is mounted; this note is the record.
 */

/*
 * ── The un-overridden `--brand-indigo` on `--brand-soft` holdouts ────────────
 *
 * The exclusion note above used to assert a completeness claim by hand ("at every
 * text site", "the one remaining un-overridden site"), and both halves were
 * wrong. Hand-written coverage claims in this file have now been wrong twice —
 * the rotted `file:line` citations were the first time — so this one is DERIVED
 * the same way the render sites are: the scan below finds the real holdouts and
 * the list is only allowed to say which ones are known.
 *
 * NOT a contrast assertion. These pairs deliberately do not clear 4.5:1 in dark,
 * the fix is shell-wide, and this skin may not make it. What is asserted is that
 * the KNOWN SET IS THE REAL SET, in both directions: a new holdout fails, and a
 * holdout somebody fixes fails too, so nobody has to trust the prose.
 */

/** Shared chrome: every non-test source file under `src/` outside `src/skins/`. */
function sharedChromeFiles(): string[] {
  return readdirSync(SRC_ROOT, { recursive: true, encoding: "utf8" })
    .map((rel) => rel.split(path.sep).join("/"))
    .filter((rel) => /\.tsx?$/.test(rel) && !/\.(test|spec)\./.test(rel))
    .filter((rel) => !rel.startsWith("skins/"))
    .sort();
}

/**
 * `file:line` for every shared-chrome class string that inks `--brand-indigo` on
 * a `--brand-soft` ground and does NOT re-ink it behind a `dark:` variant.
 *
 * Line-scoped because every such class string in this tree is written on one
 * line; a multi-line `cn()` argument would escape the scan, which is why the
 * declared list below is checked to still MATCH rather than merely be believed.
 */
function unOverriddenBrandSoftInk(): string[] {
  const overridden = /\bdark:[^\s"'`]*text-brand-violet\b/;
  return sharedChromeFiles().flatMap((file) =>
    readFileSync(path.join(SRC_ROOT, file), "utf8")
      .split("\n")
      .flatMap((text, index) =>
        /\btext-brand-indigo\b/.test(text) &&
        /\bbg-brand-soft\b/.test(text) &&
        !overridden.test(text)
          ? [`${file}:${index + 1}`]
          : [],
      ),
  );
}

/**
 * The holdouts as of this commit, each with what it costs. Both are shell chrome
 * shared by five skins, so neither is this file's to fix; both are on the
 * follow-up list. Kept as `Site` patterns rather than line numbers for the reason
 * the header gives: hand-written line numbers in this file rotted once already.
 */
const UN_OVERRIDDEN_BRAND_SOFT_INK: readonly (Site & { cost: string })[] = [
  {
    file: "components/ui/button.tsx",
    pattern:
      /border border-hairline bg-surface text-ink[^"]*hover:text-brand-indigo\b/,
    // The `outline` variant's hovered LABEL — real text, and the half of the old
    // claim that mattered. 2.75:1 in banking dark, 1.21:1 in keel dark.
    cost: "an unreadable button label on hover, in dark, in five skins",
  },
  {
    file: "components/ui/theme-toggle.tsx",
    pattern: /text-ink-muted hover:bg-brand-soft hover:text-brand-indigo\b/,
    // The theme toggle's hovered ICON. Non-text, so WCAG 1.4.3 does not reach it
    // (1.4.11 would, at 3:1) — the lesser of the two, and the only one the old
    // note admitted to.
    cost: "a low-contrast icon on hover, in dark",
  },
];

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

describe("Bellwether theme.css contrast", () => {
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
    // The half of this guard that the hand-written `file:line` citations were
    // supposed to be and were not: a pair whose class pair no longer appears
    // anywhere is guarding a combination the app does not paint, and must fail
    // rather than keep passing. The located lines are printed so the next reader
    // can go and look — the thing the stale citations made impossible.
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

  describe("the brand-soft ink holdouts are the holdouts we know about", () => {
    // Guards the DELIBERATE EXCLUSIONS note, which twice claimed coverage it did
    // not have. Nothing here asserts a ratio: the fix is shell-wide and out of
    // this skin's reach. It asserts only that the note cannot understate the gap.

    it("still finds each declared holdout where it says it is", () => {
      for (const site of UN_OVERRIDDEN_BRAND_SOFT_INK) {
        const found = findSites([site]);
        expect(
          found,
          `${site.file} no longer matches the declared holdout pattern — either ` +
            `it was restyled (drop it from UN_OVERRIDDEN_BRAND_SOFT_INK) or the ` +
            `pattern rotted`,
        ).not.toEqual([]);
        console.info(
          `brand-soft ink holdout: ${found.join(", ")} — ${site.cost}`,
        );
      }
    });

    it("finds no shared-chrome holdout the list does not name", () => {
      const declared = new Set(
        UN_OVERRIDDEN_BRAND_SOFT_INK.flatMap((site) => findSites([site])),
      );
      const undeclared = unOverriddenBrandSoftInk().filter(
        (id) => !declared.has(id),
      );
      expect(
        undeclared,
        `shared chrome inks --brand-indigo on --brand-soft with no dark override ` +
          `at a site the exclusion note does not admit to: ${undeclared.join(", ")}. ` +
          `Add it to UN_OVERRIDDEN_BRAND_SOFT_INK (with what it costs) or give it ` +
          `a dark:text-brand-violet counterpart.`,
      ).toEqual([]);
    });

    it("keeps no holdout on the list after it is fixed", () => {
      // The dead-exemption half. A list that only ever grows drifts back into
      // overstating the gap the other way round, and a reader who checks one
      // entry and finds it already fixed stops trusting the rest.
      const live = new Set(unOverriddenBrandSoftInk());
      const stale = UN_OVERRIDDEN_BRAND_SOFT_INK.flatMap((site) =>
        findSites([site]).filter((id) => !live.has(id)),
      );
      expect(
        stale,
        `these are listed as un-overridden but now carry a dark override (or no ` +
          `longer sit on brand-soft): ${stale.join(", ")}. Remove them.`,
      ).toEqual([]);
    });
  });

  it("reads the light block even if theme.css is reordered", () => {
    // `indexOf(".theme-commerce {")` also matches inside `.dark .theme-commerce
    // {`, so with the dark rule first every light assertion silently moved to the
    // dark block. Anchoring to a line start is what makes the lookup positional-
    // independent; this proves it on a reordered file rather than on ours.
    const reordered = [
      ".dark .theme-commerce {",
      "  --brand: 1 1% 1%;",
      "}",
      ".theme-commerce {",
      "  --brand: 2 2% 2%;",
      "}",
    ].join("\n");
    expect(parseRule(reordered, ".theme-commerce")["--brand"]).toEqual([
      2, 2, 2,
    ]);
    expect(parseRule(reordered, ".dark .theme-commerce")["--brand"]).toEqual([
      1, 1, 1,
    ]);
  });

  it("composites an alpha tint the way a browser paints it", () => {
    // Fully opaque and fully transparent are the two ends the compositor must
    // agree with, or every tinted ground above is measured against the wrong
    // colour — which is exactly the bug this mechanism was added for.
    const rose: Hsl = [336, 78, 44];
    const white: Hsl = [0, 0, 100];
    expect(composite(rose, white, 1)).toEqual(hslToRgb(rose));
    expect(composite(rose, white, 0)).toEqual(hslToRgb(white));
    // A tint of a colour over a LIGHTER base always reduces that colour's own
    // contrast against the ground it sits on.
    expect(ratioRgb(hslToRgb(rose), composite(rose, white, 0.12))).toBeLessThan(
      contrastRatio(rose, white),
    );
  });

  it("re-values --brand-foreground in dark, because dark lifts --brand", () => {
    // The regression this whole file exists for: a dark block that lifts the
    // brand fill and leaves the label colour behind. Asserting the OVERRIDE is
    // present (not merely that the ratio happens to pass) is what stops the
    // pairing from silently drifting apart again.
    expect(darkOverrides["--brand"]).toBeDefined();
    expect(darkOverrides["--brand-foreground"]).toBeDefined();
  });

  it("keeps the calculator honest against known WCAG values", () => {
    // Black on white is exactly 21:1; a colour against itself is exactly 1:1.
    expect(contrastRatio([0, 0, 0], [0, 0, 100])).toBeCloseTo(21, 5);
    expect(contrastRatio([206, 72, 30], [206, 72, 30])).toBeCloseTo(1, 5);
    // #767676 on white is the canonical 4.54:1 AA boundary grey.
    expect(contrastRatio([0, 0, 46.3], [0, 0, 100])).toBeCloseTo(4.54, 1);
  });
});
