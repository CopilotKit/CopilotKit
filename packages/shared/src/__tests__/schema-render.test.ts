import { describe, expect, it } from "vitest";
import { defaultGenerativeUIPromptSpec } from "../generative-ui/prompt-spec";
import type { GenerativeUISchemaSettings } from "../generative-ui/prompt-spec";
import {
  applyDescriptionOverrides,
  renderGenerativeUIComponentList,
  renderGenerativeUISchema,
  schemaCoverage,
} from "../generative-ui/schema-render";
import type { GenerativeUIManifest } from "../generative-ui/types";

const manifest: GenerativeUIManifest = {
  catalogId: "test/schema@1",
  components: {
    Text: {
      description: "Shows text",
      props: {
        type: "object",
        properties: {
          text: { type: "string", description: "The text" },
          size: { enum: ["sm", "md"] },
        },
        required: ["text"],
      },
    },
    Button: {
      description: "A button",
      props: { type: "object", properties: { label: { type: "string" } } },
      events: { onClick: { description: "Action" } },
    },
  },
  functions: {
    formatCurrency: {
      description: "Formats money",
      parameters: { type: "object", description: "{value: number}" },
    },
  },
  targets: [{ id: "chat", kind: "chat" }],
  surfaces: {},
};

const settings = (
  notation: GenerativeUISchemaSettings["notation"],
): GenerativeUISchemaSettings => ({
  notation,
  propDescriptions: true,
  commonProps: true,
});

describe("renderGenerativeUISchema", () => {
  it("writes the lines schema that ships by default", () => {
    expect(
      renderGenerativeUISchema(
        manifest,
        defaultGenerativeUIPromptSpec().schema.markdown,
      ),
    ).toBe(renderGenerativeUISchema(manifest, settings("lines")));
  });

  it.each(["compact", "json-schema", "ts-signature", "lines"] as const)(
    "covers every component and prop in %s notation",
    (notation) => {
      const text = renderGenerativeUISchema(manifest, settings(notation));
      expect(schemaCoverage(manifest, text).missing).toEqual([]);
    },
  );

  it("writes one signature line per component, with events", () => {
    const text = renderGenerativeUISchema(manifest, settings("ts-signature"));
    expect(text).toContain(
      '- Text(text: string // The text, size?: "sm" | "md"): Shows text',
    );
    expect(text).toContain("  events: onClick(Action)");
    expect(text).toContain("- formatCurrency{value: number}: Formats money");
  });

  it("separates a function name from parameters that are not an object", () => {
    const withCalls: GenerativeUIManifest = {
      ...manifest,
      functions: {
        clearCart: { parameters: { type: "object", properties: {} } },
        setVolume: { parameters: { type: "number" } },
      },
    };
    for (const notation of ["lines", "ts-signature"] as const) {
      const text = renderGenerativeUISchema(withCalls, settings(notation));
      expect(text).toContain("clearCart{}");
      expect(text).toContain("setVolume(number)");
    }
  });

  it("keeps the quotes of enum values that would read as a type or a number", () => {
    const text = renderGenerativeUISchema(
      {
        ...manifest,
        components: {
          Icon: {
            props: {
              type: "object",
              properties: {
                size: { anyOf: [{ enum: ["sm", "md"] }, { type: "number" }] },
                format: { enum: ["number", "currency"] },
                level: { enum: ["1", "2"] },
                tone: { enum: ["calm", "loud"] },
                stringFlags: { enum: ["true", "false"] },
                booleanFlags: { enum: [true, false] },
                note: {
                  type: "string",
                  description: "First line\nIcon: not a component",
                },
              },
            },
          },
        },
      },
      settings("lines"),
    );
    expect(text).toContain(' size: "sm"|"md"|number');
    expect(text).toContain(' format: "number"|"currency"');
    expect(text).toContain(' level: "1"|"2"');
    expect(text).toContain(" tone: calm|loud");
    expect(text).toContain(' stringFlags: "true"|"false"');
    expect(text).toContain(" booleanFlags: true|false");
    expect(text).toContain(" note: string - First line Icon: not a component");
  });

  it("writes the status of a deleted or failed surface in signature notation", () => {
    const text = renderGenerativeUISchema(
      {
        ...manifest,
        surfaces: {
          old: { target: "chat", status: "deleted" },
          bad: { target: "chat", status: "failed" },
        },
      },
      settings("ts-signature"),
    );
    expect(text).toContain("- old (target chat) status: deleted");
    expect(text).toContain("- bad (target chat) status: failed");
  });

  it("writes lines: one line per prop, bare enums, required marked *, events as action props", () => {
    const text = renderGenerativeUISchema(manifest, settings("lines"));
    expect(text).toContain(
      "Text: Shows text\n text*: string - The text\n size: sm|md",
    );
    expect(text).toContain(
      "Button: A button\n label: string\n onClick: action - Action",
    );
    expect(text).toContain("formatCurrency{value: number}: Formats money");
    expect(text).not.toContain('\\"');
  });

  it("writes slots as componentId and childList props in lines notation", () => {
    const withSlots: GenerativeUIManifest = {
      ...manifest,
      components: {
        Card: {
          props: { type: "object", properties: {} },
          slots: { child: "single", children: "multiple" },
        },
      },
    };
    const text = renderGenerativeUISchema(withSlots, settings("lines"));
    expect(text).toContain("Card\n child: componentId\n children: childList");
    expect(text).not.toContain("slots");
  });

  it("leaves the prop descriptions out on request", () => {
    for (const notation of [
      "compact",
      "json-schema",
      "ts-signature",
      "lines",
    ] as const) {
      const text = renderGenerativeUISchema(manifest, {
        ...settings(notation),
        propDescriptions: false,
      });
      expect(text).not.toContain("The text");
      expect(text).toContain("Shows text");
    }
  });
});

describe("renderGenerativeUIComponentList", () => {
  it("writes each notation for the tool guide and covers the catalog", () => {
    for (const notation of [
      "compact",
      "json-schema",
      "ts-signature",
      "lines",
    ] as const) {
      const text = renderGenerativeUIComponentList(
        manifest.components,
        settings(notation),
      );
      expect(schemaCoverage(manifest, text).missing).toEqual([]);
    }
  });
});

describe("applyDescriptionOverrides", () => {
  it("replaces only the named descriptions and reports unknown keys", () => {
    const { manifest: next, unknown } = applyDescriptionOverrides(manifest, {
      Text: "Prose in a surface",
      "Text.size": "How big",
      Nope: "x",
      "Text.nope": "y",
    });
    expect(next.components.Text.description).toBe("Prose in a surface");
    expect(next.components.Text.props.properties).toMatchObject({
      size: { description: "How big" },
      text: { description: "The text" },
    });
    expect(next.components.Button).toEqual(manifest.components.Button);
    expect(unknown).toEqual(["Nope", "Text.nope"]);
    // The input is not changed.
    expect(manifest.components.Text.description).toBe("Shows text");
  });
});

describe("applyDescriptionOverrides with inherited keys", () => {
  it("treats __proto__ as unknown and never touches Object.prototype", () => {
    const { unknown } = applyDescriptionOverrides(manifest, {
      __proto__: "polluted",
      "Text.__proto__": "polluted",
      "Text.constructor": "polluted",
    } as Record<string, string>);
    expect(({} as { description?: string }).description).toBeUndefined();
    expect(unknown).toEqual(
      expect.arrayContaining(["Text.__proto__", "Text.constructor"]),
    );
  });
});

describe("schemaCoverage", () => {
  it("reports a prop that the text leaves out", () => {
    const text = renderGenerativeUISchema(
      manifest,
      settings("ts-signature"),
    ).replace("size", "");
    expect(schemaCoverage(manifest, text).missing).toEqual(["Text.size"]);
  });
});
