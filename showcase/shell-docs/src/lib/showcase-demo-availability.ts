/**
 * Whether an integration ships a runnable Showcase demo for a cell, and the
 * neutral notice `<InlineDemo>` shows (in HTML and raw Markdown) when it
 * doesn't. "No demo yet" is not "unsupported": the catalog's `unsupported`
 * status, from the manifest's `not_supported_features`, keeps its own
 * "Not supported on …" box.
 */
import type { Demo } from "./registry";

/** True when the manifest has a routed demo for `demo`, so an embed has a page to load. */
export function hasShowcaseDemo(
  integration: { demos?: readonly Pick<Demo, "id" | "route">[] },
  demo: string,
): boolean {
  return (integration.demos ?? []).some(
    (entry) => entry.id === demo && Boolean(entry.route),
  );
}

export function noShowcaseDemoTitle(integrationName: string): string {
  return `No Showcase demo for ${integrationName} yet`;
}

export function noShowcaseDemoDetail(integrationName: string): string {
  return `The Showcase doesn't include this page's live example for ${integrationName}.`;
}

/** The Markdown twin of the HTML notice, as `renderPageToLlmText` emits it. */
export function noShowcaseDemoMarkdown(integrationName: string): string {
  return [
    `> **${noShowcaseDemoTitle(integrationName)}**`,
    `> ${noShowcaseDemoDetail(integrationName)}`,
  ].join("\n");
}

/** Matches each Markdown notice line that opens a `noShowcaseDemoMarkdown` block. */
export const NO_SHOWCASE_DEMO_MARKDOWN =
  /^> \*\*No Showcase demo for .+ yet\*\*$/gm;
