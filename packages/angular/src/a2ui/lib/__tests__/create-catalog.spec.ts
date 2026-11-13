import { Component, input } from "@angular/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BASIC_FUNCTIONS } from "@a2ui/web_core/v0_9/basic_catalog";
import {
  buildCatalogContextValue,
  extractCatalogComponentSchemas,
} from "../../../lib/components/a2ui/a2ui-catalog-context";
import { CopilotA2UICatalog } from "../catalog";
import { createAngularCatalog } from "../create-catalog";
import { CopilotA2UISurface } from "../surface";

@Component({ template: "" })
class TextComponent {
  readonly props = input<{ text: string }>();
}

@Component({ template: "" })
class ButtonComponent {
  readonly label = input<string>();
}

const definitions = {
  Headline: {
    props: z.object({ text: z.string() }),
    description: "Plain text",
  },
  Button: { props: z.object({ label: z.string() }) },
};
const components = { Headline: TextComponent, Button: ButtonComponent };

describe("createAngularCatalog", () => {
  it("builds a native catalog that maps definitions to components", () => {
    const catalog = createAngularCatalog(definitions, components);

    expect(catalog).toBeInstanceOf(CopilotA2UICatalog);
    expect(catalog.surfaceComponent).toBe(CopilotA2UISurface);
    expect(catalog.id).toBe("copilotkit://angular-catalog");
    expect([...catalog.components.keys()]).toEqual(["Headline", "Button"]);
    expect(catalog.components.get("Headline")?.component).toBe(TextComponent);
    expect(catalog.components.get("Button")?.schema).toBe(
      definitions.Button.props,
    );
  });

  it("advertises definition descriptions to the agent", () => {
    const catalog = createAngularCatalog(definitions, components, {
      catalogId: "copilotkit://demo",
    });

    expect(catalog.id).toBe("copilotkit://demo");
    expect(catalog.components.get("Headline")?.schema.description).toBe(
      "Plain text",
    );
    expect(buildCatalogContextValue(catalog)).toContain("Plain text");
    expect(
      Object.keys(extractCatalogComponentSchemas(catalog).components),
    ).toEqual(["Headline", "Button"]);
  });

  it("includes the basic functions by default and allows opting out", () => {
    expect([
      ...createAngularCatalog(definitions, components).functions.keys(),
    ]).toEqual([...new Set(BASIC_FUNCTIONS.map((fn) => fn.name))]);
    expect(
      createAngularCatalog(definitions, components, { functions: [] }).functions
        .size,
    ).toBe(0);
  });

  it("rejects an entry that is neither an Angular component nor { tagName, element }", () => {
    class BadgeElement extends HTMLElement {}
    expect(() =>
      createAngularCatalog(
        { Badge: { props: z.object({}) } },
        { Badge: BadgeElement },
      ),
    ).toThrow(/needs an Angular component or \{ tagName, element \}/);
  });

  it("throws when a definition has no component", () => {
    expect(() =>
      createAngularCatalog(definitions, {
        Headline: TextComponent,
      } as unknown as typeof components),
    ).toThrow(/"Button"/);
  });
});
