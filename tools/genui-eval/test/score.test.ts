import { afterAll, describe, expect, it } from "vitest";
import { loadCases } from "../src/cases";
import { createFakeModel } from "../src/fake";
import { runSample } from "../src/harness";
import type { SampleOutput } from "../src/harness";
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
  it("fails raw validity for repaired JSON while recording successful recovery", async () => {
    const c = {
      ...cases["cafes-map"],
      id: "repaired",
      expect: { ui: true, components: ["Button"] },
    };
    const out = await runSample({
      case: c,
      transport: "markdown",
      entry: { model: "fake:offline" },
      model: createFakeModel("fake:offline"),
    });
    expect(out.parseErrors).toEqual([]);
    expect(out.repairedLines).toHaveLength(1);
    const checks = await checker.check(out.surfaces);
    const scores = scoreCode(c, out, checks);
    expect(scores.validity.pass).toBe(false);
    expect(scores.validity.reasons).toContain("repaired fence line");
    expect(scores.recoveredValidity).toEqual({ pass: true, reasons: [] });
  });

  it.each([
    "replaced",
    "unreachable",
    "bound-null",
    "bound-photo",
    "bound-null-invalid-accessibility",
  ])(
    "checks expected props on final reachable instances: %s",
    async (scenario) => {
      const photo = "https://example.com/photo.png";
      const card = { id: "card", component: "EntityCard", title: "Product" };
      const out: SampleOutput = {
        text: "",
        visibleText: "",
        toolCalls: [],
        rejected: [],
        parseErrors: [],
        promptTokens: 0,
        outputTokens: 0,
        systemPrompt: "",
        surfaces: [
          {
            surfaceId: "photos",
            target: "chat",
            status: "ready",
            catalogId: "copilotkit://standard",
            rejected: [],
            operations: [
              {
                version: "v1.0",
                createSurface: {
                  surfaceId: "photos",
                  dataModel: {
                    photo: scenario === "bound-photo" ? photo : null,
                  },
                  components: [
                    { id: "root", component: "Column", children: ["card"] },
                    {
                      ...card,
                      image: scenario.startsWith("bound")
                        ? { "@path": "/photo" }
                        : photo,
                      ...(scenario === "bound-null-invalid-accessibility"
                        ? {
                            accessibility: {
                              label: {
                                "@call": "calc",
                                args: { expression: "1 +" },
                              },
                            },
                          }
                        : {}),
                    },
                  ],
                },
              },
              ...(scenario === "replaced" || scenario === "unreachable"
                ? [
                    {
                      version: "v1.0" as const,
                      updateComponents: {
                        surfaceId: "photos",
                        components:
                          scenario === "replaced"
                            ? [card]
                            : [
                                {
                                  id: "root",
                                  component: "EntityCard",
                                  title: "No photo",
                                },
                              ],
                      },
                    },
                  ]
                : []),
            ],
          },
        ],
      };
      const checks = await checker.check(out.surfaces);
      expect(checks[0].errors).toEqual([]);
      expect(checks[0].rendered).toBe(true);
      const scores = scoreCode(
        {
          ...cases["cafes-map"],
          expect: { ui: true, components: ["EntityCard.image"] },
        },
        out,
        checks,
      );
      expect(scores.fidelity.pass).toBe(scenario === "bound-photo");
    },
  );

  it("checks expected props on template instances after the first 50", async () => {
    const photo = "https://example.com/photo.png";
    const out: SampleOutput = {
      text: "",
      visibleText: "",
      toolCalls: [],
      rejected: [],
      parseErrors: [],
      promptTokens: 0,
      outputTokens: 0,
      systemPrompt: "",
      surfaces: [
        {
          surfaceId: "template-photos",
          target: "chat",
          status: "ready",
          catalogId: "copilotkit://standard",
          rejected: [],
          operations: [
            {
              version: "v1.0",
              createSurface: {
                surfaceId: "template-photos",
                dataModel: {
                  items: Array.from({ length: 51 }, (_, index) => ({
                    photo: index === 50 ? photo : null,
                  })),
                },
                components: [
                  {
                    id: "root",
                    component: "Column",
                    children: { componentId: "card", path: "/items" },
                  },
                  {
                    id: "card",
                    component: "EntityCard",
                    title: "Product",
                    image: { "@path": "photo" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const checks = await checker.check(out.surfaces);
    expect(checks[0].errors).toEqual([]);
    expect(checks[0].rendered).toBe(true);
    const scores = scoreCode(
      {
        ...cases["cafes-map"],
        expect: { ui: true, components: ["EntityCard.image"] },
      },
      out,
      checks,
    );
    expect(scores.fidelity).toEqual({ pass: true, reasons: [] });
  });

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

  it("follows child references bound to the data", async () => {
    const [check] = await checker.check([
      {
        surfaceId: "t",
        target: "chat",
        catalogId: "copilotkit://standard",
        status: "ready",
        rejected: [],
        operations: [
          {
            version: "v1.0",
            createSurface: {
              surfaceId: "t",
              dataModel: { tabs: [{ title: "Seats", child: "seats" }] },
            },
          },
          {
            version: "v1.0",
            updateComponents: {
              surfaceId: "t",
              components: [
                { id: "root", component: "Tabs", tabs: { "@path": "/tabs" } },
                {
                  id: "seats",
                  component: "Slider",
                  label: "Seats",
                  min: 1,
                  max: 9,
                  value: 3,
                },
              ],
            },
          },
        ],
      } as never,
    ]);
    expect(check.errors).toEqual([]);
    expect(check.components).toEqual(["Tabs", "Slider"]);
  });

  it("counts a template's component only when its list has items", async () => {
    const surface = (items: unknown[]) =>
      ({
        surfaceId: `tpl-${items.length}`,
        target: "chat",
        catalogId: "copilotkit://standard",
        status: "ready",
        rejected: [],
        operations: [
          {
            version: "v1.0",
            createSurface: {
              surfaceId: `tpl-${items.length}`,
              dataModel: { items },
            },
          },
          {
            version: "v1.0",
            updateComponents: {
              surfaceId: `tpl-${items.length}`,
              components: [
                {
                  id: "root",
                  component: "Column",
                  children: { componentId: "row", path: "/items" },
                },
                {
                  id: "row",
                  component: "Slider",
                  label: "Seats",
                  min: 1,
                  max: 9,
                  value: { "@path": "n" },
                },
              ],
            },
          },
        ],
      }) as never;
    const [empty, filled] = await checker.check([
      surface([]),
      surface([{ n: 3 }]),
    ]);
    expect(empty.components).toEqual(["Column"]);
    expect(filled.components).toEqual(["Column", "Slider"]);
  });

  it("visits every template item, which can bind different children", async () => {
    const [check] = await checker.check([
      {
        surfaceId: "items",
        target: "chat",
        catalogId: "copilotkit://standard",
        status: "ready",
        rejected: [],
        operations: [
          {
            version: "v1.0",
            createSurface: {
              surfaceId: "items",
              dataModel: {
                rows: [
                  { tabs: [{ title: "A", child: "label" }] },
                  { tabs: [{ title: "B", child: "seats" }] },
                ],
              },
            },
          },
          {
            version: "v1.0",
            updateComponents: {
              surfaceId: "items",
              components: [
                {
                  id: "root",
                  component: "Column",
                  children: { componentId: "row", path: "/rows" },
                },
                { id: "row", component: "Tabs", tabs: { "@path": "tabs" } },
                { id: "label", component: "Text", text: "A" },
                {
                  id: "seats",
                  component: "Slider",
                  label: "Seats",
                  min: 1,
                  max: 9,
                  value: 3,
                },
              ],
            },
          },
        ],
      } as never,
    ]);
    expect(check.components).toEqual(
      expect.arrayContaining(["Column", "Tabs", "Text", "Slider"]),
    );
  });

  it("treats a surface the reply deleted as gone, not as a crash", async () => {
    const [check] = await checker.check([
      {
        surfaceId: "gone",
        target: "chat",
        catalogId: "copilotkit://standard",
        status: "ready",
        rejected: [],
        operations: [
          {
            version: "v1.0",
            createSurface: {
              surfaceId: "gone",
              components: [{ id: "root", component: "Text", text: "x" }],
            },
          },
          { version: "v1.0", deleteSurface: { surfaceId: "gone" } },
        ],
      } as never,
    ]);
    expect(check).toMatchObject({ deleted: true, rendered: true });
    expect(check.crash).toBeUndefined();
  });

  it("follows child references computed by a function", async () => {
    const [check] = await checker.check([
      {
        surfaceId: "calc",
        target: "chat",
        catalogId: "copilotkit://standard",
        status: "ready",
        rejected: [],
        operations: [
          { version: "v1.0", createSurface: { surfaceId: "calc" } },
          {
            version: "v1.0",
            updateComponents: {
              surfaceId: "calc",
              components: [
                {
                  id: "root",
                  component: "Tabs",
                  tabs: {
                    "@call": "series",
                    args: {
                      count: 1,
                      item: { title: "T${i}", child: "seats" },
                    },
                  },
                },
                {
                  id: "seats",
                  component: "Slider",
                  label: "Seats",
                  min: 1,
                  max: 9,
                  value: 3,
                },
              ],
            },
          },
        ],
      } as never,
    ]);
    expect(check.components).toEqual(["Tabs", "Slider"]);
  });

  it("does not call a list with an action prose", async () => {
    const [check] = await checker.check([
      {
        surfaceId: "pick",
        target: "chat",
        catalogId: "copilotkit://standard",
        status: "ready",
        rejected: [],
        operations: [
          {
            version: "v1.0",
            createSurface: {
              surfaceId: "pick",
              components: [
                {
                  id: "root",
                  component: "List",
                  items: ["Monthly", "Annual"],
                  action: { event: { name: "pick" } },
                },
              ],
            },
          },
        ],
      } as never,
    ]);
    expect(check.proseOnly).toBe(false);
  });

  it("fails a surface that references a component it never sent", async () => {
    const [check] = await checker.check([
      {
        surfaceId: "hole",
        target: "chat",
        catalogId: "copilotkit://standard",
        status: "ready",
        rejected: [],
        operations: [
          {
            version: "v1.0",
            createSurface: {
              surfaceId: "hole",
              components: [
                { id: "root", component: "Column", children: ["missing"] },
              ],
            },
          },
        ],
      } as never,
    ]);
    expect(check.missing).toEqual(["missing"]);
    expect(check.reachable).toEqual(["root"]);
    const out = {
      text: "",
      visibleText: "",
      toolCalls: [],
      surfaces: [{ surfaceId: "hole", operations: [] } as never],
      rejected: [],
      parseErrors: [],
      promptTokens: 0,
      outputTokens: 0,
      systemPrompt: "",
    };
    expect(
      scoreCode(cases["cafes-map"], out, [check]).validity.reasons[0],
    ).toContain('missing component: "missing"');
  });

  it("counts a photo in an EntityCard for an Image|EntityCard.image expectation", async () => {
    const withCards = (image?: string): SampleOutput => ({
      text: "",
      visibleText: "",
      toolCalls: [],
      surfaces: [
        {
          surfaceId: "s",
          target: "chat",
          status: "ready",
          catalogId: "copilotkit://standard",
          rejected: [],
          operations: [
            {
              version: "v1.0",
              createSurface: {
                surfaceId: "s",
                components: [
                  {
                    id: "root",
                    component: "Column",
                    children: ["map", "card"],
                  },
                  { id: "map", component: "Map", markers: [] },
                  { id: "card", component: "EntityCard", title: "Café", image },
                ],
              },
            },
          ],
        },
      ],
      rejected: [],
      parseErrors: [],
      promptTokens: 0,
      outputTokens: 0,
      systemPrompt: "",
    });
    const c = {
      ...cases["cafes-map"],
      expect: { ui: true, components: ["Map", "Image|EntityCard.image"] },
    };
    const photo = withCards("https://example.com/cafe.jpg");
    const noPhoto = withCards(undefined);
    expect(
      scoreCode(c, photo, await checker.check(photo.surfaces)).fidelity,
    ).toEqual({ pass: true, reasons: [] });
    expect(
      scoreCode(c, noPhoto, await checker.check(noPhoto.surfaces)).fidelity
        .reasons,
    ).toEqual(["expected component not used: Image|EntityCard.image"]);
  });

  it("flags a surface made only of text", async () => {
    const out = {
      text: "",
      visibleText: "",
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
