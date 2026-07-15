import { describe, expect, it } from "vitest";

import { validatePersonas } from "../../lib/story";
import type {
  DeepDive,
  Persona,
  ResourceRef,
  StoryPage,
  VisualRef,
} from "../types";

function page(overrides: Partial<StoryPage> = {}): StoryPage {
  return {
    slug: "start-here",
    title: "Start here",
    claim: "A clear claim",
    body: "A concise explanation.",
    composition: "action",
    visual: {
      kind: "illustration",
      concept: "ecosystem",
      alt: "A connected ecosystem",
    },
    resources: [{ kind: "curated", id: "showcase-home" }],
    ...overrides,
  };
}

function persona(overrides: Partial<Persona> = {}): Persona {
  return {
    slug: "marketing-lead",
    name: "Marketing lead",
    group: "go-to-market",
    summary: "Understand the Showcase story.",
    question: "What should I share?",
    minutes: 5,
    pages: [page()],
    ...overrides,
  };
}

function runtimePersona(value: unknown): Persona {
  return value as Persona;
}

function expectInvalid(value: readonly Persona[], ...context: string[]): void {
  let error: unknown;

  try {
    validatePersonas(value);
  } catch (caught) {
    error = caught;
  }

  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  for (const fragment of context) {
    expect(message).toContain(fragment);
  }
}

describe("validatePersonas", () => {
  it("rejects an empty collection", () => {
    expect(() => validatePersonas([])).toThrow(/at least one persona/i);
  });

  it("accepts a minimal valid collection without mutating it", () => {
    const value = [persona()] as const;
    const before = structuredClone(value);

    expect(() => validatePersonas(value)).not.toThrow();
    expect(value).toEqual(before);
  });

  it("rejects duplicate persona slugs", () => {
    expect(() => validatePersonas([persona(), persona()])).toThrow(
      /duplicate persona slug "marketing-lead"/i,
    );
  });

  it("rejects an unknown persona slug", () => {
    expectInvalid(
      [runtimePersona({ ...persona(), slug: "unknown-persona" })],
      "unknown-persona",
      "slug",
    );
  });

  it.each([
    ["group", "unknown-group"],
    ["systemOwner", false],
  ])("rejects an invalid persona %s", (field, value) => {
    expectInvalid(
      [runtimePersona({ ...persona(), [field]: value })],
      "marketing-lead",
      field,
    );
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid minutes %s",
    (minutes) => {
      expectInvalid([persona({ minutes })], "marketing-lead", "minutes");
    },
  );

  it.each(["name", "summary", "question"] as const)(
    "rejects a blank persona %s",
    (field) => {
      expectInvalid([persona({ [field]: " \t " })], "marketing-lead", field);
    },
  );

  it("rejects a persona with no pages", () => {
    expectInvalid([persona({ pages: [] })], "marketing-lead", "pages");
  });

  it("rejects duplicate page slugs", () => {
    expectInvalid(
      [
        persona({
          pages: [
            page({ composition: "statement" }),
            page({ composition: "action" }),
          ],
        }),
      ],
      "marketing-lead",
      "start-here",
      "slug",
    );
  });

  it("rejects a blank page slug", () => {
    expectInvalid(
      [persona({ pages: [page({ slug: "  " })] })],
      "marketing-lead",
      "slug",
    );
  });

  it.each(["title", "claim", "body"] as const)(
    "rejects a blank page %s",
    (field) => {
      expectInvalid(
        [persona({ pages: [page({ [field]: "\n" })] })],
        "marketing-lead",
        "start-here",
        field,
      );
    },
  );

  it("rejects an invalid composition", () => {
    expectInvalid(
      [
        persona({
          pages: [
            runtimePersona({
              ...page(),
              composition: "unknown-composition",
            }) as unknown as StoryPage,
          ],
        }),
      ],
      "marketing-lead",
      "start-here",
      "composition",
    );
  });

  it("requires the final page to use the action composition", () => {
    expectInvalid(
      [persona({ pages: [page({ composition: "statement" })] })],
      "marketing-lead",
      "start-here",
      "action",
    );
  });

  it.each([0, 4])("rejects a page with %s resources", (count) => {
    const resources = Array.from(
      { length: count },
      (): ResourceRef => ({
        kind: "curated",
        id: "showcase-home",
      }),
    );

    expectInvalid(
      [persona({ pages: [page({ resources })] })],
      "marketing-lead",
      "start-here",
      "resources",
    );
  });

  it.each([
    { kind: "curated", id: "missing-curated-resource" },
    {
      kind: "demo",
      integration: "missing-integration",
      demo: "missing-demo",
      view: "story",
    },
    { kind: "feature", feature: "missing-feature" },
  ] as const)(
    "resolves every $kind resource through the registry",
    (resource) => {
      expectInvalid(
        [
          persona({
            pages: [
              page({
                resources: [resource as unknown as ResourceRef],
              }),
            ],
          }),
        ],
        "marketing-lead",
        "start-here",
        "resource",
      );
    },
  );

  it("resolves visual demos through the registry", () => {
    expectInvalid(
      [
        persona({
          pages: [
            page({
              visual: {
                kind: "demo",
                integration: "missing-integration",
                demo: "missing-demo",
              },
            }),
          ],
        }),
      ],
      "marketing-lead",
      "start-here",
      "visual",
    );
  });

  it.each([
    [{ kind: "illustration", concept: "ecosystem", alt: " " }, "alt"],
    [
      { kind: "illustration", concept: "missing-concept", alt: "Diagram" },
      "concept",
    ],
    [{ kind: "artifact", artifact: "missing-artifact" }, "artifact"],
    [{ kind: "checklist", items: [] }, "items"],
    [{ kind: "checklist", items: [" "] }, "items[0]"],
    [
      { kind: "ownership-handoff", perspective: "missing-perspective" },
      "perspective",
    ],
    [{ kind: "missing-visual" }, "kind"],
  ] as const)("rejects an invalid visual field %s", (visual, field) => {
    expectInvalid(
      [
        persona({
          pages: [page({ visual: visual as unknown as VisualRef })],
        }),
      ],
      "marketing-lead",
      "start-here",
      "visual",
      field,
    );
  });

  it("requires the exact deep-dive label", () => {
    expectInvalid(
      [
        persona({
          pages: [
            page({
              deepDive: runtimePersona({
                label: "Learn more",
                summary: "Details",
              }) as unknown as DeepDive,
            }),
          ],
        }),
      ],
      "marketing-lead",
      "start-here",
      "deepDive.label",
      "Go deeper",
    );
  });

  it("rejects a blank deep-dive summary", () => {
    expectInvalid(
      [
        persona({
          pages: [page({ deepDive: { label: "Go deeper", summary: " " } })],
        }),
      ],
      "marketing-lead",
      "start-here",
      "deepDive.summary",
    );
  });

  it.each(["commands", "paths", "failureModes"] as const)(
    "rejects a present but empty deep-dive %s array",
    (field) => {
      expectInvalid(
        [
          persona({
            pages: [
              page({
                deepDive: {
                  label: "Go deeper",
                  summary: "Details",
                  [field]: [],
                },
              }),
            ],
          }),
        ],
        "marketing-lead",
        "start-here",
        `deepDive.${field}`,
      );
    },
  );

  it.each(["commands", "paths", "failureModes"] as const)(
    "rejects a blank deep-dive %s item",
    (field) => {
      expectInvalid(
        [
          persona({
            pages: [
              page({
                deepDive: {
                  label: "Go deeper",
                  summary: "Details",
                  [field]: [" "],
                },
              }),
            ],
          }),
        ],
        "marketing-lead",
        "start-here",
        `deepDive.${field}[0]`,
      );
    },
  );

  const dashCases: readonly [
    name: string,
    mutate: (value: Persona, dash: string) => Persona,
    context: readonly string[],
  ][] = [
    [
      "persona name",
      (value, dash) => ({ ...value, name: `Marketing ${dash} lead` }),
      ["marketing-lead", "name"],
    ],
    [
      "persona summary",
      (value, dash) => ({ ...value, summary: `Story ${dash} summary` }),
      ["marketing-lead", "summary"],
    ],
    [
      "persona question",
      (value, dash) => ({ ...value, question: `Why ${dash} now?` }),
      ["marketing-lead", "question"],
    ],
    [
      "page title",
      (value, dash) => ({
        ...value,
        pages: [page({ title: `Start ${dash} here` })],
      }),
      ["marketing-lead", "start-here", "title"],
    ],
    [
      "page claim",
      (value, dash) => ({
        ...value,
        pages: [page({ claim: `Claim ${dash} proof` })],
      }),
      ["marketing-lead", "start-here", "claim"],
    ],
    [
      "page body",
      (value, dash) => ({
        ...value,
        pages: [page({ body: `Body ${dash} detail` })],
      }),
      ["marketing-lead", "start-here", "body"],
    ],
    [
      "illustration alt",
      (value, dash) => ({
        ...value,
        pages: [
          page({
            visual: {
              kind: "illustration",
              concept: "proof",
              alt: `Proof ${dash} diagram`,
            },
          }),
        ],
      }),
      ["marketing-lead", "start-here", "visual.alt"],
    ],
    [
      "checklist item",
      (value, dash) => ({
        ...value,
        pages: [
          page({
            visual: { kind: "checklist", items: [`Check ${dash} item`] },
          }),
        ],
      }),
      ["marketing-lead", "start-here", "visual.items[0]"],
    ],
    [
      "deep-dive label",
      (value, dash) => ({
        ...value,
        pages: [
          page({
            deepDive: {
              label: `Go ${dash} deeper` as "Go deeper",
              summary: "Details",
            },
          }),
        ],
      }),
      ["marketing-lead", "start-here", "deepDive.label"],
    ],
    [
      "deep-dive summary",
      (value, dash) => ({
        ...value,
        pages: [
          page({
            deepDive: { label: "Go deeper", summary: `Details ${dash} here` },
          }),
        ],
      }),
      ["marketing-lead", "start-here", "deepDive.summary"],
    ],
    ...(["commands", "paths", "failureModes"] as const).map(
      (
        field,
      ): [string, (value: Persona, dash: string) => Persona, string[]] => [
        `deep-dive ${field}`,
        (value, dash) => ({
          ...value,
          pages: [
            page({
              deepDive: {
                label: "Go deeper",
                summary: "Details",
                [field]: [`Value ${dash} detail`],
              },
            }),
          ],
        }),
        ["marketing-lead", "start-here", `deepDive.${field}[0]`],
      ],
    ),
  ];

  it.each(["–", "—"])(
    "rejects literal %s characters in every visible string",
    (dash) => {
      for (const [name, mutate, context] of dashCases) {
        try {
          expectInvalid([mutate(persona(), dash)], ...context);
        } catch (error) {
          throw new Error(`Dash case ${name} failed`, { cause: error });
        }
      }
    },
  );

  it("allows ASCII hyphens in visible strings", () => {
    expect(() =>
      validatePersonas([
        persona({
          name: "Marketing - lead",
          summary: "A story - in context",
          question: "Why - now?",
          pages: [
            page({
              title: "Start - here",
              claim: "A claim - with proof",
              body: "A body - with detail",
              visual: { kind: "checklist", items: ["Check - this"] },
              deepDive: {
                label: "Go deeper",
                summary: "Details - here",
                commands: ["npm run -s test"],
                paths: ["some-folder/file-name.ts"],
                failureModes: ["Build - failed"],
              },
            }),
          ],
        }),
      ]),
    ).not.toThrow();
  });
});
