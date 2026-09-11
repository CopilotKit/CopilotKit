import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { loadDoc } from "../docs-render";

const showcaseRoot = path.resolve(process.cwd(), "..");

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(showcaseRoot, relativePath), "utf8"),
  ) as T;
}

test("Google ADK supported feature links resolve to matching root guides", () => {
  const links = readJson<{
    features: Record<string, { shell_docs_path?: string }>;
  }>("integrations/google-adk/docs-links.json");
  const expected = {
    "gen-ui-tool-based": "generative-ui/display",
    "hitl-in-chat": "human-in-the-loop",
  };

  for (const [feature, slug] of Object.entries(expected)) {
    expect(links.features[feature]?.shell_docs_path).toBe(`/${slug}`);
    const guide = loadDoc(slug);
    expect(guide, `missing guide for ${feature}`).not.toBeNull();
    expect(guide!.source).toContain(`demo="${feature}"`);
  }
});

test("declarative BYOC features expose their existing guides through catalog and navigation", () => {
  const registry = readJson<{
    features: Array<{ id: string; shell_docs_path?: string }>;
  }>("shared/feature-registry.json");
  const meta = readJson<{
    pages: Array<{ title?: string; pages?: string[] }>;
  }>("shell-docs/src/content/docs/generative-ui/meta.json");
  const declarativePages = meta.pages.find(
    (section) => section.title === "Declarative",
  )?.pages;
  const expected = {
    "declarative-hashbrown": "generative-ui/hashbrown",
    "declarative-json-render": "generative-ui/json-render",
  };

  for (const [feature, slug] of Object.entries(expected)) {
    expect(
      registry.features.find((entry) => entry.id === feature)?.shell_docs_path,
    ).toBe(`/${slug}`);
    expect(loadDoc(slug)?.source).toContain(`demo="${feature}"`);
  }
  expect(declarativePages).toEqual(
    expect.arrayContaining(["hashbrown", "json-render"]),
  );
});
