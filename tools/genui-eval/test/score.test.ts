import { afterAll, describe, expect, it } from "vitest";
import { loadCases } from "../src/cases";
import { createFakeModel } from "../src/fake";
import { runSample } from "../src/harness";
import { RenderChecker } from "../src/render-check";
import { scoreCode } from "../src/score";
import type { Transport } from "../src/config";

const cases = Object.fromEntries(loadCases("train").map((c) => [c.id, c]));
const checker = new RenderChecker();
afterAll(() => checker.close());

async function score(id: string, transport: Transport = "markdown") {
  const c = cases[id];
  const out = await runSample({
    case: c,
    transport,
    entry: { model: "fake:offline" },
    model: createFakeModel("fake:offline"),
  });
  const checks = await checker.check(out.surfaces);
  return { checks, scores: scoreCode(c, out, checks) };
}

describe("scoreCode with real rendering", () => {
  it("passes a valid map surface on every tier", async () => {
    const { checks, scores } = await score("cafes-map");
    expect(checks[0].components).toContain("Map");
    expect(checks[0].rendered).toBe(true);
    expect(scores.validity).toEqual({ pass: true, reasons: [] });
    expect(scores.fidelity).toEqual({ pass: true, reasons: [] });
    expect(scores.judgement).toEqual({ pass: true, reasons: [] });
  });

  it("passes the tool transport's map surface", async () => {
    const { scores } = await score("cafes-map", "tool");
    expect(scores.validity.pass).toBe(true);
    expect(scores.fidelity.pass).toBe(true);
  });

  it("fails fidelity with the message of an invalid prop", async () => {
    const { scores } = await score("loan-calculator");
    expect(scores.validity.pass).toBe(true);
    expect(scores.fidelity.pass).toBe(false);
    expect(scores.fidelity.reasons.join(" ")).toContain(
      "Expected number, received string",
    );
  });

  it("fails validity for a broken fence line", async () => {
    const { scores } = await score("engine-strokes");
    expect(scores.validity.pass).toBe(false);
    expect(scores.validity.reasons).toContain("invalid fence line");
  });

  it("fails judgement when a UI case gets prose, and passes a prose-only case", async () => {
    expect(
      (await score("team-plan-estimator")).scores.judgement.reasons,
    ).toEqual(["no UI where UI helps"]);
    const prose = (await score("capital-of-france")).scores;
    expect(prose.judgement.pass).toBe(true);
    expect(prose.validity.pass).toBe(true);
    expect(prose.fidelity.pass).toBe(true);
  });

  it("counts only the components the root reaches", async () => {
    const [check] = await checker.check([
      {
        surfaceId: "s",
        target: "chat",
        catalogId: "copilotkit://standard",
        status: "ready",
        rejected: [],
        operations: [
          { version: "v1.0", createSurface: { surfaceId: "s" } },
          {
            version: "v1.0",
            updateComponents: {
              surfaceId: "s",
              components: [
                { id: "root", component: "Column", children: ["t"] },
                { id: "t", component: "Text", text: "Only text" },
                {
                  id: "orphan",
                  component: "Chart",
                  chartType: "bar",
                  data: [],
                  xKey: "x",
                  series: [],
                },
              ],
            },
          },
        ],
      } as never,
    ]);
    expect(check.components).toEqual(["Column", "Text"]);
    expect(check.proseOnly).toBe(true);
  });

  it("flags a surface made only of text", async () => {
    const out = {
      text: "",
      toolCalls: [],
      surfaces: [{ surfaceId: "s" } as never],
      rejected: [],
      parseErrors: [],
      promptTokens: 0,
      outputTokens: 0,
      systemPrompt: "",
    };
    const scores = scoreCode(cases["capital-of-france"], out, [
      {
        surfaceId: "s",
        rendered: true,
        errors: [],
        rejected: [],
        components: ["Column", "Text"],
        proseOnly: true,
      },
    ]);
    expect(scores.judgement.reasons).toEqual([
      "UI where prose alone is right",
      "surface with prose only",
    ]);
  });
});
