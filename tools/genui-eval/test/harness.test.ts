import type { LanguageModelV3 } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { loadCases } from "../src/cases";
import { createFakeModel } from "../src/fake";
import { applyPatch, runSample } from "../src/harness";

const cases = Object.fromEntries(loadCases("train").map((c) => [c.id, c]));
const entry = { model: "fake:offline" };
const model = () => createFakeModel("fake:offline");

describe("runSample", () => {
  it("turns a markdown reply with a map fence into one surface with a Map", async () => {
    const out = await runSample({
      case: cases["cafes-map"],
      transport: "markdown",
      entry,
      model: model(),
    });
    expect(out.error).toBeUndefined();
    expect(out.parseErrors).toEqual([]);
    expect(out.surfaces).toHaveLength(1);
    const ops = JSON.stringify(out.surfaces[0].operations);
    expect(ops).toContain('"component":"Map"');
    expect(out.systemPrompt).toContain("Generative UI markdown guide");
    expect(out.systemPrompt).toContain("Generative UI component schema");
    expect(out.promptTokens).toBeGreaterThan(1000);
  });

  it("runs a tool reply through the middleware into a surface", async () => {
    const out = await runSample({
      case: cases["cafes-map"],
      transport: "tool",
      entry,
      model: model(),
    });
    expect(out.error).toBeUndefined();
    expect(out.toolCalls).toHaveLength(1);
    expect(out.surfaces).toHaveLength(1);
    expect(out.rejected).toEqual([]);
    expect(out.surfaces[0].operations).toHaveLength(2);
    expect(out.systemPrompt).toContain("Generative UI guide");
  });

  it("sends the case's app context to the agent, on both transports", async () => {
    const withContext = {
      ...cases["cafes-map"],
      context: [
        {
          description: "Places near the user",
          value: { name: "CAFE-UNDER-TEST" },
        },
      ],
    };
    for (const transport of ["markdown", "tool"] as const) {
      const out = await runSample({
        case: withContext,
        transport,
        entry,
        model: model(),
      });
      expect(out.systemPrompt).toContain("Places near the user");
      expect(out.systemPrompt).toContain('{"name":"CAFE-UNDER-TEST"}');
    }
  });

  it("gives no surface for a prose reply", async () => {
    const out = await runSample({
      case: cases["capital-of-france"],
      transport: "markdown",
      entry,
      model: model(),
    });
    expect(out.surfaces).toEqual([]);
    expect(out.text.length).toBeGreaterThan(0);
  });

  it("reports a fence line that is not valid JSON", async () => {
    const out = await runSample({
      case: cases["engine-strokes"],
      transport: "markdown",
      entry,
      model: model(),
    });
    expect(out.parseErrors.length).toBeGreaterThan(0);
    expect(out.parseErrors[0]).toContain("invalid fence line");
  });

  it("puts the spec's guide in the prompt, on both transports", async () => {
    const { defaultGenerativeUIPromptSpec } =
      await import("@copilotkit/shared");
    const spec = defaultGenerativeUIPromptSpec();
    spec.markdown.intro = "MARKDOWN-INTRO-UNDER-TEST";
    spec.tool.intro = "TOOL-INTRO-UNDER-TEST";
    spec.descriptions = { Map: "MAP-DESCRIPTION-UNDER-TEST" };
    const md = await runSample({
      case: cases["cafes-map"],
      transport: "markdown",
      entry,
      model: model(),
      spec,
    });
    expect(md.systemPrompt).toContain("MARKDOWN-INTRO-UNDER-TEST");
    expect(md.systemPrompt).toContain("MAP-DESCRIPTION-UNDER-TEST");
    const tool = await runSample({
      case: cases["cafes-map"],
      transport: "tool",
      entry,
      model: model(),
      spec,
    });
    expect(tool.systemPrompt).toContain("TOOL-INTRO-UNDER-TEST");
    expect(tool.systemPrompt).toContain("MAP-DESCRIPTION-UNDER-TEST");
  });
});

describe("runSample with a broken tool call", () => {
  it("records malformed render_ui arguments instead of failing the run", async () => {
    const out = await runSample({
      case: cases["budget-chart"],
      transport: "tool",
      entry,
      model: createFakeModel(
        "fake:unit",
        new URL("./fixtures/", import.meta.url).pathname,
      ),
    });
    expect(out.surfaces).toEqual([]);
    expect(out.parseErrors.length + (out.error ? 1 : 0)).toBeGreaterThan(0);
  });
});

describe("runSample with a rejected operation", () => {
  it("keeps the rejections the runtime only reports in its tool result", async () => {
    const out = await runSample({
      case: cases["laptop-compare"],
      transport: "tool",
      entry,
      model: createFakeModel(
        "fake:unit",
        new URL("./fixtures/", import.meta.url).pathname,
      ),
    });
    expect(out.surfaces).toHaveLength(1);
    expect(out.rejected.map((r) => r.reason).join(" ")).toContain("ghost");
  });
});

describe("runSample with a named target", () => {
  it("rejects a surface for a target the page does not have", async () => {
    const out = await runSample({
      case: cases["color-palette"],
      transport: "markdown",
      entry,
      model: createFakeModel(
        "fake:unit",
        new URL("./fixtures/", import.meta.url).pathname,
      ),
    });
    expect(out.surfaces).toEqual([]);
    expect(out.rejected[0]?.reason).toContain(
      'targets "sidebar", which is not mounted',
    );
  });
});

describe("runSample, what the user sees", () => {
  const unit = () =>
    createFakeModel(
      "fake:unit",
      new URL("./fixtures/", import.meta.url).pathname,
    );

  it("keeps the prose the client lifts out of a fence", async () => {
    const out = await runSample({
      case: cases["capital-of-france"],
      transport: "markdown",
      entry,
      model: unit(),
    });
    expect(out.visibleText).toContain("Paris is the capital of France.");
  });

  it("rejects a renderer function call from the model", async () => {
    const out = await runSample({
      case: cases["explain-closures"],
      transport: "markdown",
      entry,
      model: unit(),
    });
    expect(out.rejected.map((r) => r.reason).join(" ")).toContain(
      "callRendererFunction",
    );
  });
});

describe("applyPatch", () => {
  it("adds to a list, replaces a field, and removes a key", () => {
    const target = { operations: [1], status: "streaming", extra: true };
    applyPatch(target, [
      { op: "add", path: "/operations/-", value: 2 },
      { op: "replace", path: "/status", value: "complete" },
      { op: "remove", path: "/extra" },
    ]);
    expect(target).toEqual({ operations: [1, 2], status: "complete" });
  });
});

describe("the markdown transport", () => {
  it("sends the model the system prompt and the conversation, and no tools", async () => {
    const { MockLanguageModelV3 } = await import("ai/test");
    const seen: Array<{ tools?: unknown; roles: string[] }> = [];
    const spy = new MockLanguageModelV3({
      doStream: async (options) => {
        seen.push({
          tools: options.tools,
          roles: options.prompt.map((m) => m.role),
        });
        return (createFakeModel("fake:offline") as LanguageModelV3).doStream(
          options,
        );
      },
    });
    await runSample({
      case: cases["capital-of-france"],
      transport: "markdown",
      entry: { model: "x/y" },
      model: spy,
    });
    expect(seen[0].tools).toBeUndefined();
    expect(seen[0].roles).toEqual(["system", "user"]);
  });
});
