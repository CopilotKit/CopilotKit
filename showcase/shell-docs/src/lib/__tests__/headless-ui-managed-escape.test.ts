import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { resolveDocsHref } from "../docs-link-rewrite";

/**
 * `snippets/shared/intelligence/headless-ui.mdx` documents the license-gated
 * `useCopilotChatHeadless_c` hook, and its callout sends managed-Intelligence
 * readers to the ungated `useAgent` guide instead.
 *
 * That snippet also renders under per-integration namespaces (ag2 and mastra
 * reach it through `snippets/shared/guides/custom-look-and-feel/headless-ui.mdx`,
 * whose own route IS `/<framework>/custom-look-and-feel/headless-ui`).
 * `resolveDocsHref` rewrites a bare `/custom-look-and-feel/headless-ui` into
 * the active framework namespace, so a bare link points those readers back at
 * the page they are already on. Prefixing the href with the root framework
 * makes it strip back to the global route on every surface.
 */
const SNIPPET = join(
  __dirname,
  "../../content/snippets/shared/intelligence/headless-ui.mdx",
);
const GLOBAL_HREF = "/custom-look-and-feel/headless-ui";

function calloutHrefs(): string[] {
  const source = readFileSync(SNIPPET, "utf8");
  return [...source.matchAll(/\[Headless UI\]\(([^)]+)\)/g)].map(
    (match) => match[1]!,
  );
}

describe("headless-UI managed escape hatch", () => {
  test("the snippet links out at least once", () => {
    expect(calloutHrefs().length).toBeGreaterThan(0);
  });

  // The namespaces that actually render this snippet, plus two that reach it
  // only through the root page, so a routing change cannot quietly narrow this.
  test.each(["ag2", "mastra", "built-in-agent", "langgraph", "adk"])(
    "resolves to the global useAgent guide under /%s",
    (framework) => {
      for (const href of calloutHrefs()) {
        expect(
          resolveDocsHref(href, {
            slugHrefPrefix: `/${framework}`,
            frameworkOverride: framework,
            frontendOverride: undefined,
          }),
        ).toBe(GLOBAL_HREF);
      }
    },
  );

  test("resolves to the global useAgent guide at the root", () => {
    for (const href of calloutHrefs()) {
      expect(
        resolveDocsHref(href, {
          slugHrefPrefix: "",
          frameworkOverride: undefined,
          frontendOverride: undefined,
        }),
      ).toBe(GLOBAL_HREF);
    }
  });
});
