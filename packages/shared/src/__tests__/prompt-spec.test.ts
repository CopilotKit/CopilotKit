import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import goldens from "./fixtures/prompt-goldens.json";
import { buildGenerativeUIMarkdownGuidelines } from "../a2ui-prompts";
import { buildGenerativeUIPrompt } from "../generative-ui/prompt";
import {
  defaultGenerativeUIPromptSpec,
  selectPromptItems,
} from "../generative-ui/prompt-spec";
import type {
  GenerativeUIComponentManifest,
  GenerativeUIManifest,
} from "../generative-ui/types";

interface Flags {
  functions: boolean;
  events: boolean;
  templates: boolean;
  checks: boolean;
  surfaces: boolean;
}

const childList = { $ref: "common_types.json#/$defs/ChildList" };

/** The manifest the goldens were captured with, for one set of flags. */
function goldenManifest(f: Flags): GenerativeUIManifest {
  const components: Record<string, GenerativeUIComponentManifest> = {
    Text: {
      description: "Shows text",
      props: {
        type: "object",
        properties: { text: { type: "string", description: "The text" } },
      },
    },
    Column: {
      description: "A column",
      props: {
        type: "object",
        properties: {
          children: f.templates
            ? childList
            : { type: "array", items: { type: "string" } },
        },
      },
      ...(f.templates ? { slots: { children: "multiple" as const } } : {}),
    },
  };
  if (f.events) {
    components.Button = {
      description: "A button",
      props: { type: "object", properties: { label: { type: "string" } } },
      events: { onClick: { description: "Action" } },
    };
  }
  if (f.checks) {
    components.TextField = {
      description: "An input",
      props: {
        type: "object",
        properties: { value: { type: "string" }, checks: { type: "array" } },
      },
    };
  }
  return {
    catalogId: "test/goldens@1",
    components,
    functions: {
      formatCurrency: {
        description: "Formats money",
        parameters: {
          type: "object",
          description: "{value: number, currency: string}",
        },
      },
      ...(f.functions
        ? {
            addToCart: {
              description: "Adds to cart",
              parameters: {
                type: "object",
                properties: { id: { type: "string" } },
              },
            },
          }
        : {}),
    },
    targets: [
      { id: "chat", kind: "chat" },
      {
        id: "sidebar",
        kind: "inline",
        description: "The side panel",
        components: ["Text"],
      },
    ],
    surfaces: f.surfaces
      ? {
          s1: {
            target: "chat",
            dataModel: { name: "Ada" },
            rejected: ["updateComponents: unknown component"],
          },
        }
      : {},
  };
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("prompt builders without a spec", () => {
  it.each(goldens.map((g) => [JSON.stringify(g.flags), g] as const))(
    "render today's text for %s",
    (_name, golden) => {
      const { surfaces: _surfaces, ...features } = golden.flags;
      expect(sha(buildGenerativeUIMarkdownGuidelines(features))).toBe(
        golden.markdown,
      );
      expect(sha(buildGenerativeUIPrompt(goldenManifest(golden.flags)))).toBe(
        golden.tool,
      );
    },
  );
});

describe("prompt builders with a spec", () => {
  const noFeatures = {
    functions: false,
    events: false,
    templates: false,
    checks: false,
  };

  it("render the default spec exactly like no spec", () => {
    const spec = defaultGenerativeUIPromptSpec();
    expect(buildGenerativeUIMarkdownGuidelines(undefined, spec)).toBe(
      buildGenerativeUIMarkdownGuidelines(),
    );
    const manifest = goldenManifest({ ...noFeatures, surfaces: true });
    expect(buildGenerativeUIPrompt(manifest, spec)).toBe(
      buildGenerativeUIPrompt(manifest),
    );
  });

  it("use the intro, the paragraph and the rules of the spec", () => {
    const spec = defaultGenerativeUIPromptSpec();
    spec.markdown.intro = "Draw UI in a2ui fences.";
    spec.markdown.whenToShow = "";
    spec.markdown.rules = ["Rule one.", "Rule two."];
    expect(buildGenerativeUIMarkdownGuidelines(noFeatures, spec)).toBe(
      "Draw UI in a2ui fences.\n\nRULES\n- Rule one.\n- Rule two.\n",
    );
    spec.tool.intro = "Use render_ui.";
    spec.tool.rules = ["Only rule."];
    const tool = buildGenerativeUIPrompt(
      goldenManifest({ ...noFeatures, surfaces: false }),
      spec,
    );
    expect(tool).toContain("## Generative UI\nUse render_ui.\n\n");
    expect(tool).toContain("Rules:\n1. Only rule.\n");
  });

  it("include a block only when all of its features hold", () => {
    const items = [
      "always",
      { when: ["checks" as const], items: ["checks only"] },
      {
        when: ["events" as const, "noFunctions" as const],
        items: ["events, no functions"],
      },
    ];
    const features = {
      functions: false,
      noFunctions: true,
      events: true,
      templates: false,
      checks: false,
      agentCalls: false,
    };
    expect(selectPromptItems(items, features)).toEqual([
      "always",
      "events, no functions",
    ]);
    expect(
      selectPromptItems(items, {
        ...features,
        checks: true,
        noFunctions: false,
      }),
    ).toEqual(["always", "checks only"]);
  });
});
