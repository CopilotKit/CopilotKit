import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import catalogData from "@/data/catalog.json";
import demoContent from "@/data/demo-content.json";
import { renderPageToLlmText } from "../llm-text";
import { getDocsFolder, getIntegration } from "../registry";
import type { Demo } from "../registry";
import {
  SELECTED_GUIDE_EXCLUSIONS,
  SELECTED_REACT_INTEGRATIONS,
  auditCommandGuide,
  auditRenderedGuide,
  collectGuideBindings,
  htmlGuideCarriers,
  renderGuideMarkdown,
  renderSelectedGuide,
  selectedShowcaseGuideBindings,
} from "../selected-showcase-guide-bindings";
import type {
  GuideBindingSources,
  GuideCarrier,
  RenderedGuide,
} from "../selected-showcase-guide-bindings";

// ---------------------------------------------------------------------------
// Synthetic fixtures: each failure mode the guard must catch.
// Run alone with `-t "synthetic"`.
// ---------------------------------------------------------------------------

function demo(id: string, extra: Partial<Demo> = {}): Demo {
  return {
    id,
    name: id,
    description: "",
    tags: [],
    route: `/demos/${id}`,
    ...extra,
  };
}

function sources(input: {
  demos: Demo[];
  paths: Record<string, string | null>;
  notSupported?: string[];
  exclusions?: Record<string, string>;
}): GuideBindingSources {
  const guides: Record<string, string> = {
    "frontend-tools": "frontend-tools",
    quickstart: "integrations/aws-strands/quickstart",
  };
  return {
    frameworks: ["strands"],
    integration: (framework) =>
      framework === "strands"
        ? { demos: input.demos, not_supported_features: input.notSupported }
        : undefined,
    docsPath: (_framework, featureId) => input.paths[featureId],
    resolveGuide: (_framework, slugPath) =>
      guides[slugPath] ? { contentSlugPath: guides[slugPath] } : null,
    exclusions: input.exclusions ?? {},
  };
}

const binding = {
  framework: "strands",
  cell: "frontend-tools",
  contentSlugPath: "frontend-tools",
};
const OWN_CODE = 'useFrontendTool({\n  name: "change_background",\n});';
const FOREIGN_CODE = 'useFrontendTool({\n  name: "langgraph_background",\n});';
const NOTICE =
  "> **Not supported on AWS Strands (Python)**\n> AWS Strands (Python) doesn't support Frontend Tools. See [the framework grid](/) for which integrations support this feature.";

function carrier(overrides: Partial<GuideCarrier> = {}): GuideCarrier {
  return {
    kind: "snippet",
    label: '<Snippet region="frontend-tool-registration" />',
    framework: "strands",
    cell: "frontend-tools",
    html: { status: "code", code: OWN_CODE },
    alternatives: [{ framework: "langgraph-python", code: FOREIGN_CODE }],
    ...overrides,
  };
}

function guide(
  markdown: string[],
  carriers: GuideCarrier[] = [carrier()],
): RenderedGuide {
  return { markdown: ["# Frontend Tools", ...markdown].join("\n\n"), carriers };
}

const fenced = (code: string) => `\`\`\`tsx\n${code}\n\`\`\``;

describe("guard failure modes (synthetic)", () => {
  test("binds a demo whose docs path resolves", () => {
    const result = collectGuideBindings(
      sources({
        demos: [demo("frontend-tools")],
        paths: { "frontend-tools": "/frontend-tools" },
      }),
    );
    expect(result.failures).toEqual([]);
    expect(result.bindings).toEqual([
      {
        framework: "strands",
        cell: "frontend-tools",
        route: "/demos/frontend-tools",
        command: null,
        slugPath: "frontend-tools",
        contentSlugPath: "frontend-tools",
      },
    ]);
  });

  test("a null docs path fails instead of dropping the cell", () => {
    const result = collectGuideBindings(
      sources({
        demos: [demo("frontend-tools"), demo("voice")],
        paths: { "frontend-tools": "/frontend-tools", voice: null },
      }),
    );
    expect(result.bindings.map((entry) => entry.cell)).toEqual([
      "frontend-tools",
    ]);
    expect(result.failures).toEqual([
      expect.stringContaining("strands:voice: no docs path"),
    ]);
  });

  test("a docs path that resolves to no guide fails", () => {
    const result = collectGuideBindings(
      sources({
        demos: [demo("frontend-tools")],
        paths: { "frontend-tools": "/frontend-tool" },
      }),
    );
    expect(result.bindings).toEqual([]);
    expect(result.failures).toEqual([
      "strands:frontend-tools: docs path /frontend-tool resolves to no guide",
    ]);
  });

  test("manifest-unsupported cells and reviewed exclusions are declared, stale exclusions fail", () => {
    const result = collectGuideBindings(
      sources({
        demos: [demo("voice"), demo("agentic-chat")],
        paths: {},
        notSupported: ["voice"],
        exclusions: {
          "strands:agentic-chat": "Routed to the quickstart on purpose.",
          "strands:retired-cell": "Left over from a removed demo.",
        },
      }),
    );
    expect(result.bindings).toEqual([]);
    expect(result.declaredUnsupported).toEqual(["strands:voice"]);
    expect(result.excluded).toEqual([
      {
        key: "strands:agentic-chat",
        reason: "Routed to the quickstart on purpose.",
      },
    ]);
    expect(result.failures).toEqual([
      "strands:retired-cell: stale exclusion, no selected demo has this id",
    ]);
  });

  test("a guide that renders its own framework and cell passes", () => {
    expect(
      auditRenderedGuide(binding, guide([fenced(OWN_CODE)]), new Set()),
    ).toEqual([]);
  });

  test("a page that renders a different cell fails", () => {
    const failures = auditRenderedGuide(
      binding,
      guide([fenced(OWN_CODE)], [carrier({ cell: "frontend-tools-async" })]),
      new Set(),
    );
    expect(failures).toEqual([
      "strands:frontend-tools -> frontend-tools: renders no strands::frontend-tools Snippet or InlineDemo (page carries: strands::frontend-tools-async)",
    ]);
  });

  test("a snippet pinned to another framework fails", () => {
    const failures = auditRenderedGuide(
      binding,
      guide(
        [fenced(OWN_CODE), fenced(FOREIGN_CODE)],
        [
          carrier(),
          carrier({
            label:
              '<Snippet framework="langgraph-python" region="frontend-tool-registration" />',
            framework: "langgraph-python",
            html: { status: "code", code: FOREIGN_CODE },
            alternatives: [],
          }),
        ],
      ),
      new Set(),
    );
    expect(failures).toEqual([
      expect.stringContaining(
        "renders langgraph-python::frontend-tools, not strands",
      ),
    ]);
  });

  test("Markdown that substitutes another framework's code fails", () => {
    const failures = auditRenderedGuide(
      binding,
      guide([fenced(FOREIGN_CODE)]),
      new Set(),
    );
    expect(failures).toEqual([
      expect.stringContaining("Markdown lacks the code HTML renders"),
      expect.stringContaining("Markdown renders langgraph-python code"),
    ]);
  });

  test("Markdown skip markers fail", () => {
    const failures = auditRenderedGuide(
      binding,
      guide([
        fenced(OWN_CODE),
        "<!-- snippet skipped: no demo for strands::frontend-tools-async -->",
        "<!-- setup skipped: frontend-tools-setup is not bundled for strands -->",
        "<!-- interactive demo skipped: no demo for strands::voice -->",
      ]),
      new Set(),
    );
    expect(failures).toEqual([
      expect.stringContaining(
        "Markdown marker <!-- snippet skipped: no demo for strands::frontend-tools-async -->",
      ),
      expect.stringContaining("Markdown marker <!-- setup skipped:"),
      expect.stringContaining("Markdown marker <!-- interactive demo skipped:"),
    ]);
  });

  test('a "Not supported" notice on a supported binding fails', () => {
    const failures = auditRenderedGuide(
      binding,
      guide(
        [NOTICE],
        [carrier({ html: { status: "unsupported" }, alternatives: [] })],
      ),
      new Set(),
    );
    expect(failures).toEqual([
      expect.stringContaining(
        'says "Not supported" for strands::frontend-tools, which strands does not declare unsupported',
      ),
      expect.stringContaining("renders no strands::frontend-tools"),
    ]);
  });

  test('a Markdown-only "Not supported" notice fails', () => {
    const failures = auditRenderedGuide(
      binding,
      guide([fenced(OWN_CODE), NOTICE]),
      new Set(),
    );
    expect(failures).toEqual([
      expect.stringContaining(
        'Markdown shows 1 "Not supported" notice(s); HTML shows 0',
      ),
    ]);
  });

  test('a "Not supported" notice for a declared-unsupported sibling cell is allowed', () => {
    const failures = auditRenderedGuide(
      binding,
      guide(
        [fenced(OWN_CODE), NOTICE],
        [
          carrier(),
          carrier({
            cell: "shared-state-streaming",
            html: { status: "unsupported" },
            alternatives: [],
          }),
        ],
      ),
      new Set(["shared-state-streaming"]),
    );
    expect(failures).toEqual([]);
  });

  test("an HTML warning box fails even when Markdown looks fine", () => {
    const failures = auditRenderedGuide(
      binding,
      guide(
        [fenced(OWN_CODE)],
        [
          carrier(),
          carrier({
            label: '<Snippet region="gone" />',
            html: {
              status: "missing",
              reason: "Missing snippet Region gone not found",
            },
            alternatives: [],
          }),
        ],
      ),
      new Set(),
    );
    expect(failures).toEqual([
      expect.stringContaining(
        'HTML <Snippet region="gone" />: Missing snippet Region gone not found',
      ),
    ]);
  });

  test("a command-only cell must resolve to its framework's own quickstart", () => {
    const command = { framework: "strands", cell: "cli-start" };
    expect(
      auditCommandGuide(
        { ...command, contentSlugPath: "integrations/aws-strands/quickstart" },
        "# Quickstart",
        "aws-strands",
      ),
    ).toEqual([]);
    expect(
      auditCommandGuide(
        { ...command, contentSlugPath: "quickstart" },
        "# Quickstart\n\n<!-- snippet skipped: no demo for strands::cli-start -->",
        "aws-strands",
      ),
    ).toEqual([
      expect.stringContaining("Markdown marker <!-- snippet skipped:"),
      "strands:cli-start -> quickstart: resolves to quickstart, not integrations/aws-strands/quickstart",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Real renderers against a synthetic page. Fixture cells are picked from the
// generated bundle so the page exercises real HTML components and real
// Markdown resolution without depending on authored guide content.
// ---------------------------------------------------------------------------

interface BundledRegion {
  code: string;
}
const bundle = (
  demoContent as {
    demos: Record<string, { regions?: Record<string, BundledRegion> }>;
  }
).demos;

function regionsOf(key: string): Array<[string, string]> {
  return Object.entries(bundle[key]?.regions ?? {})
    .map(([name, region]): [string, string] => [name, region.code])
    .filter(([, code]) => code.trim().length >= 40);
}

function frameworksWith(cell: string): string[] {
  return Object.keys(bundle)
    .filter((key) => key.endsWith(`::${cell}`))
    .map((key) => key.split("::")[0]);
}

/** A cell region the framework has AND another framework has differently. */
function sharedRegion(framework: string) {
  for (const key of Object.keys(bundle)) {
    const [owner, cell] = key.split("::");
    if (owner !== framework) continue;
    for (const [region, code] of regionsOf(key)) {
      for (const other of frameworksWith(cell)) {
        const otherCode = bundle[`${other}::${cell}`]?.regions?.[region]?.code;
        if (other !== framework && otherCode && otherCode !== code) {
          return { cell, region, code, other, otherCode };
        }
      }
    }
  }
  throw new Error(`no shared region fixture for ${framework}`);
}

/** A cell region another framework has but `framework` has no demo for. */
function foreignOnlyRegion(framework: string) {
  for (const key of Object.keys(bundle)) {
    const [owner, cell] = key.split("::");
    if (owner === framework || bundle[`${framework}::${cell}`]) continue;
    const [first] = regionsOf(key);
    if (first) return { cell, region: first[0], code: first[1] };
  }
  throw new Error(`no foreign-only region fixture for ${framework}`);
}

function catalogUnsupportedCell(framework: string): string {
  const cell = (
    catalogData as {
      cells: Array<{ integration: string; feature: string; status: string }>;
    }
  ).cells.find(
    (entry) =>
      entry.integration === framework && entry.status === "unsupported",
  )?.feature;
  if (!cell) throw new Error(`no unsupported catalog cell for ${framework}`);
  return cell;
}

function renderSyntheticMarkdown(source: string, framework: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guide-guard-"));
  const filePath = path.join(dir, "guide.mdx");
  fs.writeFileSync(filePath, source);
  try {
    // `__reference__/` pages are read straight from `filePath`, which lets a
    // synthetic MDX file go through the real Markdown renderer.
    return renderPageToLlmText(
      {
        url: `${framework}/synthetic-guide`,
        title: "Synthetic guide",
        filePath,
        loadSlug: "__reference__/synthetic-guide",
        framework,
      },
      { framework },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("guard failure modes (synthetic page, real renderers)", () => {
  const framework = "langgraph-python";
  const own = sharedRegion(framework);
  const foreignOnly = foreignOnlyRegion(framework);
  const unsupportedCell = catalogUnsupportedCell(framework);
  const source = [
    "---",
    "title: Synthetic guide",
    `snippet_cell: ${own.cell}`,
    "---",
    `<InlineDemo demo="${own.cell}" />`,
    `<Snippet region="${own.region}" />`,
    `<Snippet cell="${foreignOnly.cell}" region="${foreignOnly.region}" />`,
    `<Snippet framework="${own.other}" region="${own.region}" />`,
    `<Snippet cell="${unsupportedCell}" region="${own.region}" />`,
  ].join("\n\n");
  const rendered: RenderedGuide = {
    markdown: renderSyntheticMarkdown(source, framework),
    carriers: htmlGuideCarriers({
      source,
      defaultCell: own.cell,
      slugPath: "synthetic-guide",
      framework,
    }),
  };

  test("HTML carriers come from the real Snippet and InlineDemo components", () => {
    expect(
      rendered.carriers.map((entry) => [
        entry.kind,
        entry.framework,
        entry.cell,
        entry.html.status,
      ]),
    ).toEqual([
      ["inline-demo", framework, own.cell, "live"],
      ["snippet", framework, own.cell, "code"],
      ["snippet", framework, foreignOnly.cell, "missing"],
      ["snippet", own.other, own.cell, "code"],
      ["snippet", framework, unsupportedCell, "unsupported"],
    ]);
    expect(rendered.carriers[1]!.html).toEqual({
      status: "code",
      code: own.code,
    });
    expect(rendered.carriers[1]!.alternatives).toContainEqual({
      framework: own.other,
      code: own.otherCode,
    });
  });

  test("Markdown marks the missing cell instead of substituting another framework", () => {
    expect(rendered.markdown).toContain(own.code);
    expect(rendered.markdown).toContain(
      `<!-- snippet skipped: no demo for ${framework}::${foreignOnly.cell} -->`,
    );
    expect(rendered.markdown).not.toContain(foreignOnly.code);
  });

  test("the audit reports the missing cell, the pinned foreign snippet, and nothing else", () => {
    const failures = auditRenderedGuide(
      { framework, cell: own.cell, contentSlugPath: "synthetic-guide" },
      rendered,
      new Set([unsupportedCell]),
    );
    expect(failures).toEqual([
      expect.stringContaining(
        `Markdown marker <!-- snippet skipped: no demo for ${framework}::${foreignOnly.cell} -->`,
      ),
      expect.stringContaining(
        `HTML <Snippet cell="${foreignOnly.cell}" region="${foreignOnly.region}" />: Missing snippet`,
      ),
      expect.stringContaining(
        `renders ${own.other}::${own.cell}, not ${framework}`,
      ),
    ]);
  });

  test("the audit rejects an unsupported notice the manifest does not declare", () => {
    const failures = auditRenderedGuide(
      { framework, cell: own.cell, contentSlugPath: "synthetic-guide" },
      rendered,
      new Set(),
    );
    expect(failures).toContainEqual(
      expect.stringContaining(
        `says "Not supported" for ${framework}::${unsupportedCell}`,
      ),
    );
  });

  test("the audit rejects a binding whose cell the page does not render", () => {
    const failures = auditRenderedGuide(
      { framework, cell: foreignOnly.cell, contentSlugPath: "synthetic-guide" },
      rendered,
      new Set([unsupportedCell]),
    );
    expect(failures).toContainEqual(
      expect.stringContaining(
        `renders no ${framework}::${foreignOnly.cell} Snippet or InlineDemo`,
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// The guard itself, over the real generated docs.
// ---------------------------------------------------------------------------

describe("selected Showcase guides (real docs)", () => {
  test("every selected demo binds to an effective guide or a declared exclusion", () => {
    const collection = selectedShowcaseGuideBindings();
    console.info(
      [
        "Declared unsupported (manifest not_supported_features):",
        ...collection.declaredUnsupported.map((key) => `  ${key}`),
        "Reviewed exclusions (SELECTED_GUIDE_EXCLUSIONS):",
        ...collection.excluded.map(({ key, reason }) => `  ${key}: ${reason}`),
      ].join("\n"),
    );
    expect(collection.failures).toEqual([]);
    expect(collection.bindings.length).toBeGreaterThan(0);
  });

  test("each runnable binding renders its own framework and cell in HTML and Markdown", () => {
    const runnable = selectedShowcaseGuideBindings().bindings.filter(
      (entry) => entry.route !== null || entry.command === null,
    );
    expect(runnable.length).toBeGreaterThan(0);

    const renders = new Map<string, RenderedGuide>();
    const failures = runnable.flatMap((entry) => {
      const key = `${entry.framework}|${entry.slugPath}|${entry.contentSlugPath}`;
      let rendered = renders.get(key);
      if (!rendered) {
        rendered = renderSelectedGuide(entry);
        renders.set(key, rendered);
      }
      return auditRenderedGuide(
        entry,
        rendered,
        new Set(getIntegration(entry.framework)?.not_supported_features ?? []),
      );
    });
    expect(failures).toEqual([]);
  }, 300_000);

  test("each command-only binding resolves to its framework's own quickstart", () => {
    const expected = SELECTED_REACT_INTEGRATIONS.flatMap((framework) => {
      const integration = getIntegration(framework);
      const unsupported = new Set(integration?.not_supported_features ?? []);
      return (integration?.demos ?? [])
        .filter(
          (entry) =>
            !entry.route &&
            entry.command &&
            !unsupported.has(entry.id) &&
            !(`${framework}:${entry.id}` in SELECTED_GUIDE_EXCLUSIONS),
        )
        .map((entry) => `${framework}:${entry.id}`);
    });
    // Every selected framework ships a CLI start command.
    expect(new Set(expected.map((key) => key.split(":")[0]))).toEqual(
      new Set(SELECTED_REACT_INTEGRATIONS),
    );

    const commandOnly = selectedShowcaseGuideBindings().bindings.filter(
      (entry) => entry.route === null && entry.command !== null,
    );
    expect(
      commandOnly.map((entry) => `${entry.framework}:${entry.cell}`).sort(),
    ).toEqual(expected.sort());

    const failures = commandOnly.flatMap((entry) =>
      auditCommandGuide(
        entry,
        renderGuideMarkdown(entry),
        getDocsFolder(entry.framework),
      ),
    );
    expect(failures).toEqual([]);
  }, 120_000);
});
