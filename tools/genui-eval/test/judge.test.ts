import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { loadCases } from "../src/cases";
import { createFakeModel } from "../src/fake";
import {
  calibrate,
  judgePrompt,
  judgeSample,
  parseVerdict,
} from "../src/judge";
import type { LabelRow } from "../src/judge";
import type { SampleOutput } from "../src/harness";

const c = loadCases("train").find((x) => x.id === "cafes-map")!;
const out: SampleOutput = {
  text: "Here are the cafes.\n\n```a2ui\n{}\n```\n\nEnjoy.",
  visibleText: "Here are the cafes.\n\n[surface cafes]\n\nEnjoy.",
  toolCalls: [],
  surfaces: [
    {
      surfaceId: "cafes",
      target: "chat",
      catalogId: "x",
      status: "ready",
      rejected: [],
      operations: [
        {
          version: "v1.0",
          createSurface: {
            surfaceId: "cafes",
            components: [{ id: "root", component: "Map", markers: [] }],
          },
        } as never,
      ],
    },
  ],
  rejected: [],
  parseErrors: [],
  promptTokens: 0,
  outputTokens: 0,
  systemPrompt: "",
};

function replies(...texts: string[]) {
  let call = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [
        { type: "text", text: texts[Math.min(call++, texts.length - 1)] },
      ],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: {
          total: 10,
          noCache: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 5, text: 5, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

describe("judge", () => {
  it("shows the judge the request, the prose and an outline of the surfaces", () => {
    const prompt = judgePrompt(c, out);
    expect(prompt).toContain(c.message);
    expect(prompt).toContain(
      "Here are the cafes.\n\n[surface cafes]\n\nEnjoy.",
    );
    expect(prompt).toContain('root: Map {"markers":[]}');
  });

  it("outlines the final UI: the last version of a component, no deleted surface", async () => {
    const { outlineSurfaces } = await import("../src/judge");
    const surface = (id: string, ops: unknown[]) => ({
      surfaceId: id,
      target: "chat",
      catalogId: "x",
      status: "ready" as const,
      rejected: [],
      operations: ops as never[],
    });
    const text = outlineSurfaces({
      ...out,
      surfaces: [
        surface("kept", [
          {
            version: "v1.0",
            createSurface: {
              surfaceId: "kept",
              components: [{ id: "root", component: "Text", text: "old" }],
            },
          },
          {
            version: "v1.0",
            updateComponents: {
              surfaceId: "kept",
              components: [{ id: "root", component: "Text", text: "new" }],
            },
          },
        ]),
        surface("gone", [
          {
            version: "v1.0",
            createSurface: {
              surfaceId: "gone",
              components: [{ id: "root", component: "Chart" }],
            },
          },
          { version: "v1.0", deleteSurface: { surfaceId: "gone" } },
        ]),
      ],
    });
    expect(text).toContain('root: Text {"text":"new"}');
    expect(text).not.toContain("old");
    expect(text).not.toContain("gone");
  });

  it("leaves components out of the outline that do not render", async () => {
    const { outlineSurfaces } = await import("../src/judge");
    const text = outlineSurfaces(
      {
        ...out,
        surfaces: [
          {
            surfaceId: "s",
            target: "chat",
            catalogId: "x",
            status: "ready",
            rejected: [],
            operations: [
              {
                version: "v1.0",
                createSurface: {
                  surfaceId: "s",
                  components: [
                    { id: "root", component: "Form", children: [] },
                    { id: "orphan", component: "Slider" },
                  ],
                },
              } as never,
            ],
          },
        ],
      },
      6000,
      new Map([["s", ["root"]]]),
    );
    expect(text).toContain("root: Form");
    expect(text).not.toContain("Slider");
  });

  it("keeps the judge prompt within its byte budget, also for dense text", async () => {
    const { MAX_JUDGE_TOKENS } = await import("../src/cost");
    const prompt = judgePrompt(
      { ...c, message: "汉".repeat(50_000) },
      { ...out, visibleText: "字".repeat(50_000) },
    );
    expect(Buffer.byteLength(prompt, "utf8")).toBeLessThanOrEqual(
      MAX_JUDGE_TOKENS.input,
    );
  });

  it("parses a verdict, also inside a fence", () => {
    const v = parseVerdict(
      '```json\n{"judgement":{"score":1,"reason":"a"},"quality":{"score":0.5,"reason":"b"}}\n```',
    );
    expect(v?.quality.score).toBe(0.5);
    expect(parseVerdict("no json")).toBeUndefined();
  });

  it("retries once, then records the judge as failed instead of a score", async () => {
    const good =
      '{"judgement":{"score":0.9,"reason":"ok"},"quality":{"score":0.6,"reason":"ok"}}';
    const retried = await judgeSample(replies("oops", good), c, out);
    expect(retried.judgement.score).toBe(0.9);
    expect(retried.costTokens).toEqual({ input: 20, output: 10 });
    const failed = await judgeSample(replies("oops", "still oops"), c, out);
    expect(failed.judgement).toEqual({ score: null, reason: "judge failed" });
  });

  it("works with the fake judge", async () => {
    const result = await judgeSample(createFakeModel("fake:judge"), c, out);
    expect(result.judgement.score).toBe(0.8);
  });
});

describe("calibrate", () => {
  const row = (judge: number, human: number | null): LabelRow => ({
    key: "k",
    case: "c",
    message: "",
    reply: "",
    surfaces: "",
    judge: { judgement: judge, quality: judge },
    human: { judgement: human, quality: null },
  });

  it("counts agreement on pass or fail over the labelled rows only", () => {
    const result = calibrate([
      row(0.9, 1),
      row(0.2, 0),
      row(0.7, 0),
      row(0.4, null),
    ]);
    expect(result.judgement).toEqual({ agreement: 2 / 3, labelled: 3 });
    expect(result.quality).toEqual({ agreement: null, labelled: 0 });
  });
});
