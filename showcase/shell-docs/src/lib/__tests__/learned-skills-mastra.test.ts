import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const guide = readFileSync(
  new URL(
    "../../content/docs/intelligence/learned-skills.mdx",
    import.meta.url,
  ),
  "utf8",
);
const section = guide.split("### Mastra\n")[1]?.split("\n### ")[0] ?? "";

test("the Mastra example initializes, registers, and calls the wrapped agent", async () => {
  const code = section.match(/```typescript\n([\s\S]*?)```/)?.[1];
  expect(code, "Mastra needs a runnable setup example").toBeDefined();
  expect(code).toContain('from "@copilotkit/intelligence-mastra"');
  expect(code).toContain('from "@mastra/core/agent"');

  const calls: string[] = [];
  class SkillRegistry {
    async initialize() {
      calls.push("initialize");
    }
  }
  const tools = { copilotkit_load_skill: {}, copilotkit_read_skill_file: {} };
  const skills = {
    tools,
    wrapAgent(agent: Agent) {
      expect(agent.options.inputProcessors).toContain(skills);
      expect(agent.options.tools).toEqual(tools);
      calls.push("wrap");
      return {
        async generate() {
          calls.push("generate");
        },
      };
    },
  };
  class Agent {
    constructor(
      public options: { inputProcessors: unknown[]; tools: unknown },
    ) {}
    generate() {
      throw new Error("The example bypassed the wrapper");
    }
  }
  const createSkillRegistryProcessor = ({
    registry,
  }: {
    registry: unknown;
  }) => {
    expect(registry).toBeInstanceOf(SkillRegistry);
    expect(calls).toEqual(["initialize"]);
    return skills;
  };
  // Run the displayed setup with inert boundaries: no model or network calls.
  const body = code!.replace(/import\s+[\s\S]*?from\s+"[^"]+";\s*/g, "");
  const run = new Function(
    "Agent",
    "SkillRegistry",
    "createSkillRegistryProcessor",
    `return (async () => {${body}})();`,
  );
  await run(Agent, SkillRegistry, createSkillRegistryProcessor);
  expect(calls).toEqual(["initialize", "wrap", "generate"]);
});

test("Mastra documents supported entry points and delivery cancellation limits", () => {
  expect(section).toContain("22.13");
  expect(section).toContain("@mastra/core>=1.0.0,<2");
  for (const method of [
    "generate",
    "stream",
    "resumeGenerate",
    "resumeStream",
  ]) {
    expect(section).toContain(`\`${method}\``);
  }
  expect(section).toContain("abortSignal");
  expect(section).toContain("defaultOptions");
  expect(section).toContain("background workers");
  expect(section).toContain("each selected agent");
});
