/**
 * Anti-drift guard for the drawer's structural layout values.
 *
 * The default width (`--cpk-drawer-width`) and the mobile breakpoint live in
 * `layout-constants.ts` as the single source of truth. Three other surfaces
 * restate them and MUST stay in sync:
 *  - the shadow-DOM styles (`styles.ts`) — the `--cpk-drawer-width` fallback,
 *  - the shipped host stylesheet (`layout.css`) — the `:root` default and the
 *    responsive collapse media query (CSS media queries cannot read a JS
 *    constant, so the literal is asserted here instead), and
 *  - the exported query string the element's `matchMedia` listens on.
 *
 * These tests read the raw source text so a hand-edit to any copy that diverges
 * from the constants fails loudly.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  DRAWER_DEFAULT_WIDTH,
  DRAWER_DEFAULT_WIDTH_PX,
  MOBILE_BREAKPOINT_PX,
  MOBILE_MAX_WIDTH_PX,
  MOBILE_MAX_WIDTH_QUERY,
} from "../layout-constants";
import { drawerStyles } from "../styles";

const dirname = path.dirname(fileURLToPath(import.meta.url));
// __tests__ -> threads-drawer
const drawerDir = path.resolve(dirname, "..");
const LAYOUT_CSS = path.join(drawerDir, "layout.css");

function readLayoutCss(): string {
  return readFileSync(LAYOUT_CSS, "utf8");
}

test("derived width + breakpoint constants are internally consistent", () => {
  expect(DRAWER_DEFAULT_WIDTH).toBe(`${DRAWER_DEFAULT_WIDTH_PX}px`);
  expect(MOBILE_MAX_WIDTH_PX).toBe(MOBILE_BREAKPOINT_PX - 1);
  expect(MOBILE_MAX_WIDTH_QUERY).toBe(`(max-width: ${MOBILE_MAX_WIDTH_PX}px)`);
});

test("shadow-DOM styles fall back to the drawer default width constant", () => {
  const cssText = drawerStyles.cssText;

  expect(cssText).toContain(`var(--cpk-drawer-width, ${DRAWER_DEFAULT_WIDTH})`);
});

test("shipped layout.css :root default matches the drawer width constant", () => {
  const css = readLayoutCss();

  expect(css).toContain(`--cpk-drawer-width: ${DRAWER_DEFAULT_WIDTH};`);
});

test("shipped layout.css collapse media query matches the mobile breakpoint", () => {
  const css = readLayoutCss();

  expect(css).toContain(`@media ${MOBILE_MAX_WIDTH_QUERY} {`);
  // Guard against a stale copy of the OLD (pre-reconciliation) 768px literal.
  expect(css).not.toContain(`max-width: ${MOBILE_BREAKPOINT_PX}px`);
});
