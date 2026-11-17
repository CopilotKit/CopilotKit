import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Every integration's src/app/globals.css is a copy of langgraph-python's.
// The demo pages are the same in every integration and rely on it: its
// `height: 100%` on <html> and <body> lets a full-page <CopilotChat> fill the
// page. When a copy drifted to `body { min-height: 100vh }`, the chat in
// agentic-chat and beautiful-chat shrank to the height of its welcome screen
// and sat at the top of the page. This guard fails CI on that drift.

const INTEGRATIONS_DIR = resolve(__dirname, "..", "..", "integrations");
const CANONICAL_SLUG = "langgraph-python";

function globalsCssPath(slug: string): string {
  return resolve(INTEGRATIONS_DIR, slug, "src", "app", "globals.css");
}

const slugs = readdirSync(INTEGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((slug) => existsSync(globalsCssPath(slug)));

describe("integration globals.css drift guard", () => {
  it("finds the canonical stylesheet and the integrations that copy it", () => {
    expect(slugs).toContain(CANONICAL_SLUG);
    expect(slugs.length).toBeGreaterThan(1);
  });

  const canonical = readFileSync(globalsCssPath(CANONICAL_SLUG), "utf8");

  it.each(slugs.filter((slug) => slug !== CANONICAL_SLUG))(
    "%s/src/app/globals.css is byte-identical to langgraph-python's",
    (slug) => {
      // If this fails, copy integrations/langgraph-python/src/app/globals.css
      // over this integration's file. To change the styles, change the
      // langgraph-python file first, then copy it to every integration.
      expect(readFileSync(globalsCssPath(slug), "utf8")).toBe(canonical);
    },
  );
});
