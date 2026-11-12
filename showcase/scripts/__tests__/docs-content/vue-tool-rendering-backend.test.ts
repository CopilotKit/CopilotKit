import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { describe, expect, test } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const page = matter(read("showcase/shell-docs/src/content/docs/frontends/vue/generative-ui/tool-rendering.mdx"));

describe("Vue tool-rendering backend example", () => {
  test("defaults an unscoped Vue page to the built-in agent without pinning explicit backends", () => {
    expect(page.data.snippet_framework).toBe("built-in-agent");
    expect(page.data.snippet_cell).toBe("tool-rendering");
    expect(page.content).toContain('<Snippet region="weather-tool-backend"');
    expect(page.content).not.toMatch(/<Snippet[^>]*\bframework=/);
  });

  test("explains how to match the built-in tool contract and register it", () => {
    const backend = read("showcase/integrations/built-in-agent/src/lib/factory/server-tools.ts")
      .split("// @endregion[weather-tool-backend]")[0];
    expect(backend).toContain('name: "weather"');
    expect(backend).toContain("city: z.string()");
    expect(page.content).toContain('name: "weather"');
    expect(page.content).toContain("`city`");
    expect(page.content).toContain("[Server Tools](/server-tools)");
  });
});
