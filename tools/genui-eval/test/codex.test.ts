import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { generateText } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCases } from "../src/cases";
import { codexArgs, parseCodexEvents, splitPrompt } from "../src/codex";
import { defineEvalConfig, resolvePlan } from "../src/config";
import { runSample } from "../src/harness";
import { createLanguageModel, requireKey } from "../src/models";

const FAKE_CODEX = new URL("./fixtures/codex/fake-codex.mjs", import.meta.url)
  .pathname;
const saved = { ...process.env };

beforeAll(() => {
  // A signed-in Codex home for the clean home to link, and the stand-in CLI.
  const home = mkdtempSync(`${tmpdir()}/codex-auth-`);
  writeFileSync(`${home}/auth.json`, "{}");
  process.env.CODEX_HOME = home;
  process.env.GENUI_EVAL_CODEX_BIN = FAKE_CODEX;
  process.env.GENUI_EVAL_RESULTS = mkdtempSync(`${tmpdir()}/codex-results-`);
});
afterAll(() => {
  process.env = saved;
});

describe("the codex backend", () => {
  it("sends the system prompt as the instructions and the user turn on stdin", async () => {
    const reported: Array<{ log?: string }> = [];
    const model = createLanguageModel(
      { model: "codex:gpt-5.6-luna", params: { reasoningEffort: "low" } },
      (meta) => reported.push(meta),
    );
    const result = await generateText({
      model,
      system: "RUBRIC LINE\nmore",
      prompt: "grade this",
    });
    expect(result.text).toContain("INSTRUCTIONS:RUBRIC LINE");
    expect(result.text).toContain("PROMPT:grade this");
    expect(result.text).toContain("MODEL:gpt-5.6-luna");
    expect(result.text).toContain('EFFORT:"low"');
    // Not the user's own Codex home: only its sign-in.
    expect(result.text).not.toContain(`HOME:${process.env.CODEX_HOME}`);
    expect(result.usage.inputTokens).toBe(120);
    const log = reported[0].log!;
    expect(readFileSync(`${log}/instructions.md`, "utf8")).toBe(
      "RUBRIC LINE\nmore",
    );
    expect(readFileSync(`${log}/prompt.md`, "utf8")).toBe("grade this");
    expect(readFileSync(`${log}/events.jsonl`, "utf8")).toContain(
      '"agent_message"',
    );
  });

  it("runs a case through the real pipeline: the generative UI guide is the instructions", async () => {
    const c = loadCases("train").find((x) => x.id === "capital-of-france")!;
    const out = await runSample({
      case: c,
      transport: "markdown",
      entry: { model: "codex:gpt-5.6-luna" },
      model: createLanguageModel({ model: "codex:gpt-5.6-luna" }),
    });
    expect(out.error).toBeUndefined();
    expect(out.text).toContain(`PROMPT:${c.message}`);
    expect(out.text).not.toContain("[case:");
  });

  it("needs no OpenRouter key", () => {
    expect(() => requireKey(["codex:gpt-5.6-luna"], {})).not.toThrow();
  });

  it("asks codex for a plain reply: our instructions, no user config, no tools or extras, read-only", () => {
    const args = codexArgs({
      slug: "gpt-5.6-luna",
      instructionsFile: "/x/instructions.md",
      cwd: "/x/cwd",
      lastMessageFile: "/x/last.md",
      reasoningEffort: "medium",
    });
    for (const flag of [
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
    ]) {
      expect(args).toContain(flag);
    }
    expect(args.join(" ")).toContain("--sandbox read-only");
    expect(args).toContain('model_instructions_file="/x/instructions.md"');
    expect(args).toContain("include_collaboration_mode_instructions=false");
    expect(args).toContain("features.shell_tool=false");
    expect(args).toContain('model_reasoning_effort="medium"');
    expect(args.at(-1)).toBe("-");
  });

  it("splits a prompt into instructions and the conversation", () => {
    expect(
      splitPrompt([
        { role: "system", content: "A" },
        { role: "system", content: "B" },
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ]),
    ).toEqual({ instructions: "A\n\nB", text: "hi" });
    expect(
      splitPrompt([
        { role: "user", content: [{ type: "text", text: "one" }] },
        { role: "assistant", content: [{ type: "text", text: "two" }] },
        { role: "user", content: [{ type: "text", text: "three" }] },
      ]).text,
    ).toBe("User: one\n\nAssistant: two\n\nUser: three");
  });

  it("reads the last message and the usage, and fails on a turn with no message", () => {
    const events = [
      '{"type":"item.completed","item":{"type":"error","message":"a warning"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}',
      '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":4,"output_tokens":3,"reasoning_output_tokens":1}}',
    ].join("\n");
    expect(parseCodexEvents(events)).toEqual({
      text: "hello",
      usage: { input: 10, cachedInput: 4, output: 3, reasoning: 1 },
    });
    expect(() =>
      parseCodexEvents(
        '{"type":"turn.failed","error":{"message":"usage limit"}}',
      ),
    ).toThrow("codex returned no message: usage limit");
  });
});

describe("resolvePlan with command-line models", () => {
  const config = defineEvalConfig({
    models: [{ id: "fake", model: "fake:offline" }],
    presets: { p: { models: ["fake"], cases: "all", samples: 1 } },
    transports: ["markdown"],
    budgetUsd: 1,
    judge: { model: "fake:judge" },
    reflection: { model: "fake:reflect" },
  });

  it("runs a model string that is not in the config, with the judge and effort given", () => {
    const plan = resolvePlan(config, "p", {
      models: ["codex:gpt-5.6-luna"],
      judge: "codex:gpt-5.6-sol",
      reasoningEffort: "high",
    });
    expect(plan.models).toEqual([
      {
        id: "codex:gpt-5.6-luna",
        model: "codex:gpt-5.6-luna",
        params: { reasoningEffort: "high" },
      },
    ]);
    expect(plan.judge).toBe("codex:gpt-5.6-sol");
    expect(() => resolvePlan(config, "p", { models: ["nope"] })).toThrow(
      'Unknown model "nope"',
    );
  });
});
