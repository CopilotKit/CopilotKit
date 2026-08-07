/**
 * Ordered categorical ramp for the dark canvas (hsl(225 24% 6%)). Ordered, not
 * arbitrary: series 1 is always the brand azure, so a single-series chart
 * matches the rest of the chrome and a multi-series chart stays stable as
 * categories come and go.
 *
 * Validated with the dataviz skill's `validate_palette.js` against surface
 * `#0b0e14` (mode "dark"): lightness band, chroma floor, CVD separation
 * (protan/deutan), the normal-vision floor, and contrast vs surface all PASS.
 * The plan's draft values were too light for the dark-mode OKLCH band
 * (0.48–0.67) — teal, violet, amber, magenta and green all landed above 0.67,
 * several past 0.8 — so every hue but the fixed brand azure was re-stepped
 * darker/more saturated to land mid-band (~0.60), and the slot order was
 * re-optimized (enumerating all orderings of the five non-brand hues) because
 * the plan's teal→violet→amber→magenta→green order put magenta directly next
 * to green, which collapse under deuteranopia (ΔE 3.2, "fail" territory).
 * teal→amber→magenta→violet→green clears the CVD floor with the widest
 * margin (worst adjacent ΔE 10.8 deutan / 18.9 normal-vision) of any passing
 * order. Verify against the canvas with the dataviz skill's contrast
 * validator before changing a value — a hue that reads fine on white can
 * vanish here.
 */
export const SERIES_COLORS = [
  "hsl(217 91% 60%)", // azure — the brand, fixed regardless of slot order
  "hsl(172 76% 33%)", // teal
  "hsl(38 92% 36%)", // amber
  "hsl(330 80% 49%)", // magenta
  "hsl(268 82% 62%)", // violet
  "hsl(150 62% 37%)", // green
];

/**
 * Diverging pair + neutral midpoint, for the plan-variance waterfall. Kept at
 * the plan's values: each clears >=3:1 contrast against the `#0b0e14` canvas
 * (negative 6.1:1, neutral 3.6:1, positive 10.1:1), and negative/positive stay
 * distinguishable under simulated color-vision deficiency (deutan ΔE 8.4,
 * protan ΔE 23.2) — the waterfall's bar direction is the primary signal, so
 * color here is a secondary encoding, not the only one.
 */
export const DIVERGING = {
  negative: "hsl(355 85% 66%)",
  neutral: "hsl(225 14% 45%)",
  positive: "hsl(152 65% 52%)",
};
