import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

function readRequiredFile(relativePath: string) {
  const absolutePath = resolve(repositoryRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`${relativePath} must exist`);
  }
  return readFileSync(absolutePath, "utf8");
}

function gitCheckIgnore(relativePath: string) {
  return spawnSync(
    "git",
    ["check-ignore", "--quiet", "--no-index", relativePath],
    { cwd: repositoryRoot },
  ).status;
}

const sourceContracts = [
  {
    name: "LangGraph Python",
    path: "examples/integrations/langgraph-python/agent/main.py",
    required: [
      /^import os$/m,
      /^model = ChatOpenAI\(\n {4}model=os\.getenv\("OPENAI_MODEL", "gpt-5\.4-mini"\),\n {4}model_kwargs=\{"parallel_tool_calls": False\},\n\)$/m,
    ],
    prohibited: [
      /^model = ChatOpenAI\(model="gpt-5\.4-mini", model_kwargs=\{"parallel_tool_calls": False\}\)$/m,
    ],
  },
  {
    name: "LangGraph JS",
    path: "examples/integrations/langgraph-js/agent/src/agent.ts",
    required: [
      /^const model = new ChatOpenAI\(\{\n {2}model: process\.env\.OPENAI_MODEL \?\? "gpt-5\.4",\n {2}modelKwargs: \{ parallel_tool_calls: false \},\n\}\);$/m,
    ],
    prohibited: [/^ {2}model: "gpt-5\.4",$/m],
  },
  {
    name: "Mastra",
    path: "examples/integrations/mastra/src/mastra/agents/index.ts",
    required: [
      /^import \{ createOpenAI \} from "@ai-sdk\/openai";$/m,
      /^const openai = createOpenAI\(\{\n {2}apiKey: process\.env\.OPENAI_API_KEY,\n {2}baseURL: process\.env\.OPENAI_BASE_URL,\n\}\);$/m,
      /^export const weatherAgent = new Agent\(\{\n {2}id: "weather-agent",\n {2}name: "Weather Agent",\n {2}tools: \{ weatherTool \},\n {2}model: openai\(process\.env\.OPENAI_MODEL \?\? "gpt-4o"\),$/m,
    ],
    prohibited: [
      /^import \{ openai \} from "@ai-sdk\/openai";$/m,
      /^ {2}model: openai\("gpt-4o"\),$/m,
    ],
  },
  {
    name: "MCP Apps",
    path: "examples/integrations/mcp-apps/app/agent.ts",
    required: [
      /^ {2}const agent = new BuiltInAgent\(\{\n {4}model: "openai\/" \+ \(process\.env\.OPENAI_MODEL \?\? "gpt-4o"\),\n {4}prompt: "You are a helpful assistant\.",\n {2}\}\);$/m,
    ],
    prohibited: [/^ {4}model: "openai\/gpt-4o",$/m],
  },
];

const envContracts = [
  {
    name: "LangGraph Python",
    root: "examples/integrations/langgraph-python",
    exactContents: undefined,
  },
  {
    name: "LangGraph JS",
    root: "examples/integrations/langgraph-js",
    exactContents: undefined,
  },
  {
    name: "Mastra",
    root: "examples/integrations/mastra",
    exactContents: "OPENAI_API_KEY=\n",
  },
  {
    name: "MCP Apps",
    root: "examples/integrations/mcp-apps",
    exactContents: undefined,
  },
];

describe("starter model source contracts", () => {
  test.each(sourceContracts)(
    "$name reads its model from the environment",
    (contract) => {
      const source = readRequiredFile(contract.path);

      for (const pattern of contract.required) {
        expect
          .soft(source, `${contract.path} must match ${pattern}`)
          .toMatch(pattern);
      }
      for (const pattern of contract.prohibited) {
        expect
          .soft(source, `${contract.path} must not match ${pattern}`)
          .not.toMatch(pattern);
      }
    },
  );
});

describe("starter env contracts", () => {
  test.each(envContracts)("$name remains provider-neutral", (contract) => {
    const env = readRequiredFile(`${contract.root}/.env.example`);
    const lines = env.split(/\r?\n/);
    const activeApiKeyAssignments = lines.filter((line) =>
      /^\s*(?:export\s+)?OPENAI_API_KEY\s*=/.test(line),
    );
    const baseUrlOrModelAssignments = lines.filter((line) =>
      /^\s*(?:#+\s*)?(?:export\s+)?OPENAI_(?:BASE_URL|MODEL)\s*=/.test(line),
    );

    expect.soft(activeApiKeyAssignments).toHaveLength(1);
    expect.soft(baseUrlOrModelAssignments).toEqual([]);
    if (contract.exactContents !== undefined) {
      expect.soft(env).toBe(contract.exactContents);
    }
  });

  test.each(envContracts)(
    "$name ignores .env but exposes .env.example",
    (contract) => {
      const envStatus = gitCheckIgnore(`${contract.root}/.env`);
      const exampleStatus = gitCheckIgnore(`${contract.root}/.env.example`);

      expect.soft(envStatus, `${contract.root}/.env must be ignored`).toBe(0);
      expect
        .soft(exampleStatus, `${contract.root}/.env.example must be exposed`)
        .toBe(1);
    },
  );
});
