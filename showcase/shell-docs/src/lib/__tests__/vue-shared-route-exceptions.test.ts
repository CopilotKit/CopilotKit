import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDoc } from "../docs-render";
import { resolveVueDocExample } from "../vue-doc-examples";

const variantRoot = join(process.cwd(), "src/content/docs/frontends/vue");

const exceptionRoutes = [
  "cli",
  "build-with-agents",
  "generative-ui/mcp-apps",
  "threads-import",
  "whats-new/langgraph-deep-agents",
] as const;

function readVariant(route: (typeof exceptionRoutes)[number]): string {
  return readFileSync(join(variantRoot, `${route}.mdx`), "utf8");
}

describe("Vue shared-route exceptions", () => {
  it("loads each evidence-required Vue variant", () => {
    for (const route of exceptionRoutes) {
      expect(loadDoc(`frontends/vue/${route}`)?.fm.title).toBeTruthy();
    }
  });

  it("documents the published CLI and skills limitations without a Vue scaffold command", () => {
    const cli = readVariant("cli");
    const skills = readVariant("build-with-agents");

    expect(cli).toContain("copilotkit@4.4.0");
    expect(cli).toContain("does not include a Vue template");
    expect(cli).not.toContain("npx copilotkit@latest create");
    expect(skills).toContain("`copilotkit-setup` and `copilotkit-develop`");
    expect(skills).toContain("do not support Vue setup");
  });

  it("uses a compiled Vue provider example instead of the React MCP Apps demo", () => {
    const mcpApps = readVariant("generative-ui/mcp-apps");

    expect(mcpApps).not.toContain("<InlineDemo");
    expect(mcpApps).toContain(
      '<VueDocExample file="quickstart/App.vue" region="provider-chat-app" />',
    );
    expect(
      resolveVueDocExample("quickstart/App.vue", "provider-chat-app").code,
    ).toContain("<CopilotKitProvider");
  });

  it("keeps manual Vue setup and the Deep Agents frontend boundary explicit", () => {
    const threads = readVariant("threads-import");
    const deepAgents = readVariant("whats-new/langgraph-deep-agents");

    expect(threads).toContain("manually created Vue app");
    expect(threads).not.toContain("CLI-created app");
    expect(deepAgents).toContain(
      "do not provide a dedicated UI for interacting",
    );
    expect(deepAgents).not.toContain(
      "Users can see the agent's thought process, interact with subagents as they spawn",
    );
  });

  it("keeps Vue links on existing Vue-owned pages", () => {
    const links = exceptionRoutes.flatMap((route) => {
      const source = readVariant(route);
      return [...source.matchAll(/\]\((\/vue(?:\/[^)\s#]+)?)/g)].map(
        (match) => match[1],
      );
    });

    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      if (href === "/vue") {
        expect(existsSync(`${variantRoot}.mdx`)).toBe(true);
        continue;
      }

      const route = href.slice("/vue/".length);
      expect(
        existsSync(join(variantRoot, `${route}.mdx`)) ||
          existsSync(join(variantRoot, route, "index.mdx")) ||
          loadDoc(route) !== null,
        `missing Vue link target ${href}`,
      ).toBe(true);
    }
  });
});
