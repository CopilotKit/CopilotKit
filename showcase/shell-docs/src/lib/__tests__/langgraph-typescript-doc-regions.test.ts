import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";
import { resolveBundledSetupConcept } from "../setup-content";
import type { SetupContentBundle } from "../setup-content";
import setupContentData from "@/data/setup-content.json";

const integrationRoot = path.resolve(
  import.meta.dirname,
  "../../../../integrations/langgraph-typescript",
);
const agentRoot = path.join(integrationRoot, "src/agent");

const expectedPublicRegions = [
  "a2ui-fixed.ts::a2ui-fixed-schema-bind-tools",
  "a2ui-fixed.ts::a2ui-fixed-schema-graph",
  "a2ui-fixed.ts::a2ui-fixed-schema-tools",
  "a2ui-fixed.ts::backend-render-operations",
  "agent-config.ts::agent-config-setup",
  "frontend-tools.ts::setup",
  "gen-ui-agent.ts::gen-ui-agent-wiring",
  "interrupt-agent.ts::backend-interrupt-tool",
  "readonly-state.ts::agent-context-setup",
  "recovery-agent.ts::a2ui-recovery-agent",
  "shared-state-read.ts::shared-state-read-agent",
  "subagents.ts::subagent-setup",
  "subagents.ts::supervisor-delegation-tools",
  "tool-rendering-reasoning-chain.ts::reasoning-chain-model",
  "tool-rendering.ts::tool-rendering-bind-tools",
  "tool-rendering.ts::tool-rendering-graph",
  "tool-rendering.ts::weather-tool-backend",
];

const REGION_NAME_RX =
  /^\s*\/\/\s*(?:@region\[([^\]]+)\]|region:\s*(\S+))\s*$/gm;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Every part of `region` in source order. The same name may open more than
// once in a file: the demo bundle (showcase/scripts/bundle-demo-content.ts)
// publishes such a region to <Snippet> as its parts joined by a blank line,
// while <DemoCode> and the setup bundle reject it.
function regionParts(source: string, region: string): string[] {
  const name = escapeRegex(region);
  const namedStart = new RegExp(`^\\s*//\\s*@region\\[${name}\\]\\s*$`);
  const namedEnd = new RegExp(`^\\s*//\\s*@endregion\\[${name}\\]\\s*$`);
  const legacyStart = new RegExp(`^\\s*//\\s*region:\\s*${name}\\s*$`);
  const legacyEnd = /^\s*\/\/\s*endregion\b/;
  const lines = source.split("\n");
  const parts: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const named = namedStart.test(lines[i]);
    if (!named && !legacyStart.test(lines[i])) continue;
    const end = named ? namedEnd : legacyEnd;
    const endIndex = lines.findIndex((line, j) => j > i && end.test(line));
    if (endIndex === -1) throw new Error(`unterminated region ${region}`);
    parts.push(lines.slice(i + 1, endIndex).join("\n"));
    i = endIndex;
  }

  return parts;
}

function publishedRegion(parts: string[]): string {
  return parts.join("\n\n");
}

function publicRegions(): Map<string, string> {
  const regions = new Map<string, string>();

  for (const filename of fs
    .readdirSync(agentRoot)
    .filter((file) => file.endsWith(".ts"))) {
    const source = fs.readFileSync(path.join(agentRoot, filename), "utf8");
    const names = new Set(
      [...source.matchAll(REGION_NAME_RX)].map((match) => match[1] ?? match[2]),
    );

    for (const region of names) {
      const parts = regionParts(source, region);
      if (parts.length > 0) {
        regions.set(`${filename}::${region}`, publishedRegion(parts));
      }
    }
  }

  return regions;
}

// <DemoCode file="…" region="…" /> references in the setup pages. Their
// attributes may span several lines.
function setupDemoCodeReferences(): {
  page: string;
  file: string;
  region: string;
}[] {
  const setupRoot = path.join(integrationRoot, "docs/setup");
  const references: { page: string; file: string; region: string }[] = [];

  for (const page of fs
    .readdirSync(setupRoot)
    .filter((f) => f.endsWith(".mdx"))) {
    const mdx = fs.readFileSync(path.join(setupRoot, page), "utf8");
    for (const [tag] of mdx.matchAll(/<DemoCode\b[^>]*\/>/g)) {
      const file = /\bfile="([^"]+)"/.exec(tag)?.[1];
      const region = /\bregion="([^"]+)"/.exec(tag)?.[1];
      if (file && region) references.push({ page, file, region });
    }
  }

  return references;
}

function agentSource(filename: string): string {
  return fs.readFileSync(path.join(agentRoot, filename), "utf8");
}

describe("LangGraph TypeScript public code regions", () => {
  const regions = publicRegions();

  test("keeps the known docs regions under the repository-wide guard", () => {
    for (const region of expectedPublicRegions) {
      expect(regions.has(region), region).toBe(true);
    }
  });

  test("joins a multi-part region the way the demo bundle does", () => {
    const source = [
      "// @region[wiring]",
      "const tools = [setSteps];",
      "// @endregion[wiring]",
      "const unrelated = true;",
      "  // @region[wiring]",
      "  export const graph = compileGraph(chatNode);",
      "  // @endregion[wiring]",
    ].join("\n");

    const parts = regionParts(source, "wiring");
    expect(parts).toEqual([
      "const tools = [setSteps];",
      "  export const graph = compileGraph(chatNode);",
    ]);
    expect(publishedRegion(parts)).toBe(
      "const tools = [setSteps];\n\n  export const graph = compileGraph(chatNode);",
    );
  });

  test("keeps every setup <DemoCode> region in one part", () => {
    const references = setupDemoCodeReferences();
    expect(references.length).toBeGreaterThan(0);

    for (const { page, file, region } of references) {
      const source = fs.readFileSync(path.join(integrationRoot, file), "utf8");
      expect(
        regionParts(source, region).length,
        `${page}: ${file}::${region}`,
      ).toBe(1);
    }
  });

  test("uses only public model construction", () => {
    for (const [region, source] of regions) {
      expect(source, region).not.toContain("makeChatOpenAI");
      expect(source, region).not.toContain("./openai-headers");
    }
  });

  test.each([
    "agent-config.ts::agent-config-setup",
    "frontend-tools.ts::setup",
    "gen-ui-agent.ts::gen-ui-agent-wiring",
    "readonly-state.ts::agent-context-setup",
    "shared-state-read.ts::shared-state-read-agent",
    "subagents.ts::subagent-setup",
    "tool-rendering-reasoning-chain.ts::reasoning-chain-model",
  ])("keeps %s copyable with ChatOpenAI", (region) => {
    expect(regions.get(region), region).toContain("new ChatOpenAI({");
  });

  test("keeps header forwarding on the executable showcase graphs", () => {
    const config = JSON.parse(agentSource("langgraph.json")) as {
      graphs: Record<string, string>;
    };

    expect(config.graphs).toMatchObject({
      agent_config_agent: "./agent-config.ts:showcaseGraph",
      frontend_tools: "./frontend-tools.ts:showcaseGraph",
      gen_ui_agent: "./gen-ui-agent.ts:showcaseGraph",
      shared_state_read: "./shared-state-read.ts:showcaseGraph",
      subagents: "./subagents.ts:showcaseGraph",
      "tool-rendering-reasoning-chain":
        "./tool-rendering-reasoning-chain.ts:showcaseGraph",
    });

    // The production server (server.mjs) registers graphs from its own copy
    // of this map; it must load the same header-forwarding exports.
    const serverSource = agentSource("server.mjs");
    for (const spec of Object.values(config.graphs).filter((value) =>
      value.endsWith(":showcaseGraph"),
    )) {
      expect(serverSource, spec).toContain(`"${spec}"`);
    }

    for (const filename of [
      "agent-config.ts",
      "frontend-tools.ts",
      "gen-ui-agent.ts",
      "readonly-state.ts",
      "shared-state-read.ts",
      "subagents.ts",
      "tool-rendering-reasoning-chain.ts",
    ]) {
      expect(agentSource(filename), filename).toContain(
        "makeChatOpenAI(config",
      );
    }
  });
});

test("renders public-only LangGraph TypeScript model setup", () => {
  const setupContent = setupContentData as SetupContentBundle;

  for (const concept of [
    "a2ui-fixed-schema-setup",
    "a2ui-recovery-setup",
    "agent-setup",
    "agent-config-setup",
    "agent-context-setup",
    "frontend-tools-setup",
    "human-in-the-loop-setup",
    "programmatic-control-setup",
    "subagents-setup",
    "tool-rendering-setup",
  ]) {
    const source = resolveBundledSetupConcept(
      "langgraph-typescript",
      concept,
      setupContent,
    );

    expect(source, concept).toContain("new ChatOpenAI({");
    expect(source, concept).not.toContain("makeChatOpenAI");
    expect(source, concept).not.toContain("./openai-headers");
    expect(source, concept).not.toContain("@region[");
  }
});

test("keeps the rendered tool-rendering guide free of showcase internals", () => {
  expect(agentSource("tool-rendering.ts")).toContain(
    'import { AIMessage, SystemMessage } from "@langchain/core/messages";',
  );

  const doc = loadDoc("generative-ui/tool-rendering");
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText(
    {
      url: "langgraph-typescript/generative-ui/tool-rendering",
      title: doc!.fm.title,
      description: doc!.fm.description,
      filePath: doc!.filePath,
      loadSlug: "generative-ui/tool-rendering",
      framework: "langgraph-typescript",
    },
    { framework: "langgraph-typescript" },
  );

  expect(output).toContain('name: "get_weather"');
  expect(output).not.toContain("makeChatOpenAI");
  expect(output).not.toContain("./openai-headers");
});
