import type { CSSProperties } from "react";
import {
  oneDark,
  oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";

type PrismStyle = Record<string, CSSProperties>;

const COLOR_PROPS = new Set([
  "color",
  "background",
  "backgroundColor",
  "borderColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "fill",
  "stroke",
]);

// The code viewers paint their own themed background on <pre>; in dark mode
// the inner <code> stays transparent so it doesn't draw a box behind each
// line.
const BASE_SELECTORS = new Set([
  'pre[class*="language-"]',
  'code[class*="language-"]',
]);

/**
 * oneLight in light mode, oneDark in dark mode, picked by CSS rather than
 * JS: every color becomes `light-dark(<oneLight>, <oneDark>)`, which follows
 * `color-scheme` (`light` on :root, `dark` on :root.dark in globals.css).
 * Light mode computes to exactly the oneLight colors, and server-rendered
 * code is already right before hydration.
 */
export const oneLightDark: PrismStyle = Object.fromEntries(
  Object.entries(oneLight as PrismStyle).map(([selector, light]) => {
    const dark = (oneDark as PrismStyle)[selector] ?? {};
    const merged = Object.fromEntries(
      Object.entries(light).map(([prop, value]) => {
        if (!COLOR_PROPS.has(prop) || typeof value !== "string") {
          return [prop, value];
        }
        const darkValue =
          prop === "background" && BASE_SELECTORS.has(selector)
            ? "transparent"
            : dark[prop as keyof CSSProperties];
        return typeof darkValue === "string" && darkValue !== value
          ? [prop, `light-dark(${value}, ${darkValue})`]
          : [prop, value];
      }),
    );
    return [selector, merged as CSSProperties];
  }),
);
