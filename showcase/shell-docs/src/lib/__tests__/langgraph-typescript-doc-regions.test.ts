import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { extractRegion } from "../demo-code";
import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";
import { resolveBundledSetupConcept } from "../setup-content";
import type { SetupContentBundle } from "../setup-content";
import setupContentData from "@/data/setup-content.json";

const agentRoot = path.resolve(
  import.meta.dirname,
  "../../../../integrations/langgraph-typescript/src/agent",
);

const expectedPublicRegions = [
  "a2ui-fixed.ts::backend-render-operations",
  "agent-config.ts::agent-config-setup",
  "frontend-tools.ts::setup",
  "interrupt-agent.ts::backend-interrupt-tool",
  "readonly-state.ts::agent-context-setup",
  "subagents.ts::subagent-setup",
  "subagents.ts::supervisor-delegation-tools",
  "tool-rendering.ts::weather-tool-backend",
];

function publicRegions(): Map<string, string> {
  const regions = new Map<string, string>();

  for (const filename of fs
    .readdirSync(agentRoot)
    .filter((file) => file.endsWith(".ts"))) {
    const source = fs.readFileSync(path.join(agentRoot, filename), "utf8");
    const names = source.matchAll(
      /^\s*\/\/\s*(?:@region\[([^\]]+)\]|region:\s*(\S+))\s*$/gm,
    );

    for (const match of names) {
      const region = match[1] ?? match[2];
      const body = extractRegion(source, region, "ts");
      if (body !== null) regions.set(`${filename}::${region}`, body);
    }
  }

  return regions;
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

  test("uses only public model construction", () => {
    for (const [region, source] of regions) {
      expect(source, region).not.toContain("makeChatOpenAI");
      expect(source, region).not.toContain("./openai-headers");
    }
  });

  test.each([
    "agent-config.ts::agent-config-setup",
    "frontend-tools.ts::setup",
    "readonly-state.ts::agent-context-setup",
    "subagents.ts::subagent-setup",
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
      subagents: "./subagents.ts:showcaseGraph",
    });

    for (const filename of [
      "agent-config.ts",
      "frontend-tools.ts",
      "readonly-state.ts",
      "subagents.ts",
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
    "agent-setup",
    "agent-config-setup",
    "agent-context-setup",
    "frontend-tools-setup",
    "human-in-the-loop-setup",
    "programmatic-control-setup",
    "subagents-setup",
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
