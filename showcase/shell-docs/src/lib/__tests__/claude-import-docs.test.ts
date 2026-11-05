import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getTabDefault } from "../registry";

const content = resolve(process.cwd(), "src/content");
const read = (path: string) => readFileSync(resolve(content, path), "utf8");

describe("Claude import guide entry points", () => {
  it.each([
    ["claude-sdk-python", "Python"],
    ["claude-sdk-typescript", "TypeScript"],
  ])("opens %s on the matching import language", (slug, language) => {
    expect(getTabDefault(slug, "language_claude_sdk_import")).toBe(language);
    expect(read(`docs/integrations/${slug}/threads-import.mdx`)).toContain(
      "@/snippets/integrations/claude-sdk/threads-import.mdx",
    );
    expect(
      JSON.parse(read(`docs/integrations/${slug}/meta.json`)).pages,
    ).toContain("threads-import");
  });

  it("links all three import routes from the source list and Intelligence overview", () => {
    for (const route of [
      "/claude-sdk-python/threads-import",
      "/claude-sdk-typescript/threads-import",
      "/cookbook/claude-managed-agents-import",
    ]) {
      expect(read("snippets/shared/threads/threads-import.mdx")).toContain(
        route,
      );
      expect(read("snippets/shared/intelligence/overview.mdx")).toContain(
        route,
      );
    }
    expect(
      existsSync(
        resolve(content, "docs/cookbook/claude-managed-agents-import.mdx"),
      ),
    ).toBe(true);
    expect(JSON.parse(read("docs/cookbook/meta.json")).pages).toContain(
      "claude-managed-agents-import",
    );
  });
});
