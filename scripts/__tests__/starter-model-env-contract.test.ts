import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..");
const integrationsDir = path.join(repoRoot, "examples", "integrations");

/**
 * The starters the CopilotKit CLI clones for a developer
 * (`apps/cli/src/starter-source-catalog.ts` in CopilotKit/Intelligence).
 * AgentCore is left out on purpose: it runs Bedrock only, and the CLI's
 * fast path does not offer it.
 */
const CLI_STARTERS = [
  "langgraph-python",
  "langgraph-js",
  "langgraph-fastapi",
  "claude-sdk-typescript",
  "claude-sdk-python",
  "crewai-flows",
  "mastra",
  "pydantic-ai",
  "llamaindex",
  "agno",
  "adk",
  "adk-angular",
  "strands-python",
  "strands-typescript",
  "a2a-middleware",
  "ms-agent-framework-dotnet",
  "ms-agent-framework-python",
  "mcp-apps",
] as const;

const DOC_NAMES = new Set(["README.md", "CLAUDE.md", "AGENTS.md"]);

/** Starter docs, without anything under node_modules or a virtualenv. */
function starterDocs(starter: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (DOC_NAMES.has(entry.name)) found.push(full);
    }
  };
  walk(path.join(integrationsDir, starter));
  return found;
}

/**
 * Text that sends a developer, or a coding agent, around the
 * COPILOTKIT_AGENT_MODEL contract: editing model code, a model variable the
 * starter no longer reads, or an `echo … > .env` that erases the
 * COPILOTKIT_AGENT_MODEL line `.env.example` ships.
 */
const STALE_MODEL_INSTRUCTIONS: ReadonlyArray<[string, RegExp]> = [
  ["edit code to change the model", /\bto change the model\b/i],
  ["a hard-coded model in a snippet", /\bmodel\s*=\s*["']gpt-/],
  [
    "a legacy model variable in place of COPILOTKIT_AGENT_MODEL",
    /\b(?:CLAUDE_MODEL|OPENAI_CHAT_MODEL_ID)\b/,
  ],
  [
    "an echo that overwrites the env file",
    /\becho\s+["'][A-Z_]+=[^"']*["']\s*>(?!>)\s*\S*\.env\b/,
  ],
  ["model choice left to code edits", /\bwhatever model\b/i],
];

describe("starter model env contract (PE-701)", () => {
  test.each(CLI_STARTERS)(
    "%s/.env.example sets COPILOTKIT_AGENT_MODEL",
    (starter) => {
      const envExample = fs.readFileSync(
        path.join(integrationsDir, starter, ".env.example"),
        "utf8",
      );
      expect(envExample).toMatch(
        /^COPILOTKIT_AGENT_MODEL=(?:openai|anthropic|google)[:/]\S+$/m,
      );
    },
  );

  test.each(CLI_STARTERS)(
    "%s docs choose the model through env, not code",
    (starter) => {
      const offences = starterDocs(starter).flatMap((file) => {
        const text = fs.readFileSync(file, "utf8");
        return STALE_MODEL_INSTRUCTIONS.filter(([, pattern]) =>
          pattern.test(text),
        ).map(([what]) => `${path.relative(integrationsDir, file)}: ${what}`);
      });
      expect(offences).toEqual([]);
    },
  );

  test("crewai-flows streams with acompletion, which LiteLLM streams for every vendor", () => {
    // copilotkit_stream reads the response with `async for`. LiteLLM 1.79.3
    // supports that on a sync completion(stream=True) for OpenAI only, so
    // every Anthropic and Gemini chat failed with MidStreamFallbackError.
    const agent = fs.readFileSync(
      path.join(integrationsDir, "crewai-flows", "agent", "src", "agent.py"),
      "utf8",
    );
    expect(agent).toMatch(/await copilotkit_stream\(\s*await acompletion\(/);
    expect(agent).not.toMatch(/from litellm import completion\b/);
  });

  test("llamaindex keeps the anthropic SDK below 1.0, which llama-index-llms-anthropic calls", () => {
    // anthropic 1.x refuses the `temperature` argument that
    // llama-index-llms-anthropic 0.12 passes to models such as
    // claude-sonnet-4-5 and claude-haiku-4-5, so those chats failed before a
    // request went out.
    const pyproject = fs.readFileSync(
      path.join(integrationsDir, "llamaindex", "agent", "pyproject.toml"),
      "utf8",
    );
    expect(pyproject).toMatch(/"anthropic>=0\.108,<1"/);
  });

  test("crewai-flows sends Gemini no parallel_tool_calls=False", () => {
    // LiteLLM refuses parallel_tool_calls=False for Gemini once a request
    // carries more than one tool, and this agent always sends three or more.
    const script = [
      "import json, sys",
      "sys.path.insert(0, sys.argv[1])",
      "from model import completion_options",
      "print(json.dumps({m: completion_options(m) for m in sys.argv[2:]}))",
    ].join("\n");
    const result = spawnSync(
      "python3",
      [
        "-I",
        "-B",
        "-c",
        script,
        path.join(integrationsDir, "crewai-flows", "agent", "src"),
        "gemini/gemini-3.8-flash",
        "openai/gpt-5-mini",
        "anthropic/claude-sonnet-4-5",
      ],
      { encoding: "utf8" },
    );
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      "gemini/gemini-3.8-flash": {},
      "openai/gpt-5-mini": { parallel_tool_calls: false },
      "anthropic/claude-sonnet-4-5": { parallel_tool_calls: false },
    });
  });

  test("ms-agent-framework-python reads the root .env next to agent/.env", () => {
    // run-agent.sh starts the agent in agent/, and a bare load_dotenv() stops
    // at the nearest file. The CLI writes the model key to agent/.env, so
    // without a second load the agent never sees COPILOTKIT_AGENT_MODEL.
    const main = fs.readFileSync(
      path.join(
        integrationsDir,
        "ms-agent-framework-python",
        "agent",
        "src",
        "main.py",
      ),
      "utf8",
    );
    expect(main).toMatch(
      /load_dotenv\(\s*Path\(__file__\)\.resolve\(\)\.parents\[2\]\s*\/\s*"\.env"\s*\)/,
    );
  });

  test.each(["adk", "adk-angular"])(
    "%s warns about the key of the chosen vendor, not always Google's",
    (starter) => {
      const main = fs.readFileSync(
        path.join(integrationsDir, starter, "agent", "main.py"),
        "utf8",
      );
      expect(main).not.toMatch(/if not os\.getenv\("GOOGLE_API_KEY"\)/);
    },
  );

  test("a2a-middleware names the missing key of the chosen vendor", () => {
    const script = [
      "import json, os, sys",
      "sys.path.insert(0, sys.argv[1])",
      "from _model import missing_api_key",
      "cases = {}",
      "for spec, env in json.loads(sys.argv[2]):",
      "    for name in ('COPILOTKIT_AGENT_MODEL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'):",
      "        os.environ.pop(name, None)",
      "    os.environ.update(env)",
      "    cases[spec + ' ' + ','.join(sorted(env))] = missing_api_key('google:gemini-3.8-flash')",
      "print(json.dumps(cases))",
    ].join("\n");
    const cases = [
      ["default", {}],
      ["default", { GEMINI_API_KEY: "k" }],
      ["anthropic", { COPILOTKIT_AGENT_MODEL: "anthropic:claude-sonnet-4-5" }],
      [
        "anthropic",
        {
          COPILOTKIT_AGENT_MODEL: "anthropic:claude-sonnet-4-5",
          ANTHROPIC_API_KEY: "k",
        },
      ],
      [
        "openai",
        { COPILOTKIT_AGENT_MODEL: "openai:gpt-5-mini", GOOGLE_API_KEY: "k" },
      ],
    ];
    const result = spawnSync(
      "python3",
      [
        "-I",
        "-B",
        "-c",
        script,
        path.join(integrationsDir, "a2a-middleware", "agents"),
        JSON.stringify(cases),
      ],
      { encoding: "utf8" },
    );
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      "default ": "GOOGLE_API_KEY",
      "default GEMINI_API_KEY": null,
      "anthropic COPILOTKIT_AGENT_MODEL": "ANTHROPIC_API_KEY",
      "anthropic ANTHROPIC_API_KEY,COPILOTKIT_AGENT_MODEL": null,
      "openai COPILOTKIT_AGENT_MODEL,GOOGLE_API_KEY": "OPENAI_API_KEY",
    });
  });

  test.each([
    "agents/orchestrator.py",
    "agents/research_agent.py",
    "agents/analysis_agent.py",
  ])("a2a-middleware %s warns about the key of the chosen vendor", (file) => {
    const source = fs.readFileSync(
      path.join(integrationsDir, "a2a-middleware", file),
      "utf8",
    );
    expect(source).not.toMatch(
      /if not os\.getenv\("(?:GOOGLE|OPENAI)_API_KEY"\)/,
    );
  });
});
