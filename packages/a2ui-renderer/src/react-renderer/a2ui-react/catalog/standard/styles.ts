import React from "react";
import { borderColor, textColor, CONTROL_BG, SHADOW_XS } from "./tokens";

/**
 * Stylesheet for what inline styles cannot express: pseudo-elements
 * (slider track/thumb, placeholder), `:checked` / `:first-child` states,
 * heading fallbacks and resets for host prose styles. Injected once per
 * document.
 *
 * Typography is inherited: a surface takes the font, size, line height and
 * colour of the text around it (the chat's prose), and headings take the
 * host's heading styles.
 */

export const STANDARD_STYLE_ID = "a2ui-standard-catalog";
export const ACCENT = "var(--a2ui-color-accent, #0d0d0d)";

const CHECK_SVG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E\")";

const SLIDER_TRACK = "var(--a2ui-color-slider-track, rgba(0, 0, 0, 0.04))";
const THUMB = `width:20px;height:20px;box-sizing:border-box;border-radius:9999px;background:${CONTROL_BG};border:1px solid ${borderColor("default")};box-shadow:${SHADOW_XS};cursor:pointer`;

export const STANDARD_CSS = [
  // The surface (and its root component) never exceeds the chat column.
  ".a2ui-surface{min-width:0;max-width:100%;box-sizing:border-box}",
  // The surface inherits the host's font, size, line height and ink.
  ".a2ui-surface{font:inherit;color:inherit}",
  // Heading sizes only for hosts without heading styles (zero specificity).
  ":where(.a2ui-surface) :where(h2){font-size:1.5em;font-weight:600;line-height:1.3}",
  ":where(.a2ui-surface) :where(h3){font-size:1.25em;font-weight:600;line-height:1.3}",
  ":where(.a2ui-surface) :where(h4){font-size:1em;font-weight:600;line-height:1.4}",
  // Controls never fall back to the UA font.
  "[data-a2ui-std] :is(button,input,select,textarea),[data-a2ui-input]{font:inherit;color:inherit}",
  // Key/value rows: the trailing text of a space-between row sits flush right.
  '[data-a2ui-row="between"]>[data-a2ui-text]:last-child:not(:first-child){text-align:right;margin-inline-start:auto}',
  "[data-a2ui-input]:focus-visible{outline:2px solid var(--a2ui-color-focus, #0285ff);outline-offset:1px}",
  `[data-a2ui-input]::placeholder{color:${textColor("tertiary")};opacity:1}`,
  // Slider: 24px pill track, 2px inset white thumb (no filled range).
  `.a2ui-std-range{-webkit-appearance:none;appearance:none;display:block;width:100%;height:24px;margin:0;padding:0 2px;box-sizing:border-box;border-radius:9999px;background:${SLIDER_TRACK};cursor:pointer}`,
  ".a2ui-std-range:disabled{cursor:not-allowed;opacity:.5}",
  ".a2ui-std-range::-webkit-slider-runnable-track{height:24px;background:transparent;border:0}",
  `.a2ui-std-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;margin-top:2px;${THUMB}}`,
  ".a2ui-std-range::-moz-range-track{height:24px;background:transparent;border:0}",
  `.a2ui-std-range::-moz-range-thumb{${THUMB}}`,
  // Checkbox / radio: 20px round control, filled when checked.
  `.a2ui-std-check{-webkit-appearance:none;appearance:none;flex-shrink:0;width:20px;height:20px;margin:0;box-sizing:border-box;border:1px solid ${borderColor("strong")};border-radius:9999px;background:${CONTROL_BG} center/14px 14px no-repeat;cursor:pointer}`,
  '.a2ui-std-check[data-shape="square"]{border-radius:6px}',
  `.a2ui-std-check:checked{background-color:${ACCENT};border-color:${ACCENT};background-image:${CHECK_SVG}}`,
  `.a2ui-std-check[type="radio"]:checked{background-image:none;background-color:${CONTROL_BG};border:6px solid ${ACCENT}}`,
  ".a2ui-std-check:disabled{cursor:not-allowed}",
  // Hosts often wrap chat markdown in a "prose" stylesheet (Tailwind
  // typography) that adds margins to headings, paragraphs, lists and tables.
  // A surface is an app panel spaced by gaps: reset those margins, except
  // inside a Markdown component, which reads like the chat's prose. The
  // selector has to outrank `.prose :where(h2)`; hosts change it through
  // `--a2ui-heading-margin` / `--a2ui-block-margin`.
  ".a2ui-surface :is(h1,h2,h3,h4,h5,h6):not(.a2ui-markdown *){margin:var(--a2ui-heading-margin,0)}",
  ".a2ui-surface :is(p,table,figure,figcaption,blockquote,pre):not(.a2ui-markdown *){margin:var(--a2ui-block-margin,0)}",
  ".a2ui-markdown>:first-child{margin-top:0}",
  ".a2ui-markdown>:last-child{margin-bottom:0}",
  // Only the List component drops native bullets; Markdown keeps them.
  ".a2ui-surface :is(.a2ui-std-list,.a2ui-std-list>li){margin:0}",
  ".a2ui-surface .a2ui-std-table{font-size:inherit;line-height:inherit}",
  // Table: 8px cells, flush outer edges, hairline row dividers, no outer border.
  ".a2ui-std-table-wrap{width:100%;max-width:100%;min-width:0;overflow-x:auto}",
  ".a2ui-std-cell{padding:8px}",
  ".a2ui-std-cell:first-child{padding-inline-start:0}",
  ".a2ui-std-cell:last-child{padding-inline-end:0}",
  `.a2ui-std-cell[data-divider]{border-bottom:1px solid ${borderColor("subtle")}}`,
  ".a2ui-std-table>tbody:last-child>tr:last-child>.a2ui-std-cell{border-bottom:0}",
].join("\n");

const useInjectEffect: (
  effect: React.EffectCallback,
  deps?: React.DependencyList,
) => void =
  typeof document === "undefined"
    ? () => {}
    : (React.useInsertionEffect ?? React.useLayoutEffect);

/** Inject the standard catalog stylesheet once per document. */
export function useStandardStyles(): void {
  useInjectEffect(() => {
    if (document.getElementById(STANDARD_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STANDARD_STYLE_ID;
    style.textContent = STANDARD_CSS;
    document.head.appendChild(style);
  }, []);
}
