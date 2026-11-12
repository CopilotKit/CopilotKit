import type { ComponentType } from "react";
import { CeoDashboardPage } from "./ceo-dashboard";
import { CfoDashboardPage } from "./cfo-dashboard";
import { MetricsExplorerPage } from "./metrics-explorer";
import { BoardPacksPage } from "./board-packs";

/**
 * ⚠️ A `Map`, NOT a plain object. `resolvePage` receives untrusted URL segments,
 * and an object literal indexed by them walks the prototype chain: `/exec/
 * constructor` returns `Object.prototype.constructor`, which is a truthy
 * `Function` and slips straight past the shell's `if (!Page) notFound()` guard
 * in `src/app/[skin]/[[...rest]]/page.tsx` — a 500 where a 404 belongs. Keel and
 * commerce were re-keyed for this; `../skin.test.tsx` pins it (added with the
 * skin assembly).
 */
const PAGES = new Map<string, ComponentType>([
  ["", CeoDashboardPage],
  ["finance", CfoDashboardPage],
  ["metrics", MetricsExplorerPage],
  ["packs", BoardPacksPage],
]);

export function resolveExecPage(segments: string[]): ComponentType | null {
  const key = segments.length === 0 ? "" : segments.join("/");
  return PAGES.get(key) ?? null;
}

export {
  CeoDashboardPage,
  CfoDashboardPage,
  MetricsExplorerPage,
  BoardPacksPage,
};
