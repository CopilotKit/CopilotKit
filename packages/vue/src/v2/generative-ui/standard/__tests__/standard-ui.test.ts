import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import { z } from "zod";
import {
  exportA2UICatalog,
  standardDeclarations,
} from "@copilotkit/shared/generative-ui";
import { createGenerativeUI } from "../../catalog";
import { renderSurface } from "../../__tests__/helpers/render-surface";
import { compositeComponents } from "../composites";
import { dataComponents } from "../data";
import { feedbackComponents } from "../feedback";
import { standardUI } from "../index";
import { inputComponents } from "../inputs";
import { layoutComponents } from "../layout";
import { mediaComponents } from "../media";
import { textComponents } from "../text";

// A port of React's `standard/__tests__/standard-ui.test.tsx`, then the
// standard cases of React's `__tests__/parameter-order.test.tsx`. Vue reads
// React's fixture, as Angular does, so a catalog difference fails here.
//
// React mocks maplibre-gl to throw, so the Map shows its list of places.
// In Vue the Map shows that list without the `/map` plugin, so no mock is
// needed.

const FIXTURE = path.join(
  __dirname,
  "../../../../../../react-core/src/v2/generative-ui/standard/__tests__/fixtures/standard-all.json",
);

/** The fixture uses every standard component at least once. */
const fixtureSchema = z.object({
  components: z.array(
    z.object({ id: z.string(), component: z.string() }).passthrough(),
  ),
  data: z.record(z.string(), z.unknown()),
});
const fixture = fixtureSchema.parse(
  JSON.parse(fs.readFileSync(FIXTURE, "utf8")),
);

describe("standardUI", () => {
  it("has the id copilotkit/standard@1", () => {
    expect(standardUI.id).toBe("copilotkit/standard@1");
  });

  it("has every component of every group once, each with a description", () => {
    const groupNames = [
      layoutComponents,
      textComponents,
      inputComponents,
      feedbackComponents,
      dataComponents,
      mediaComponents,
      compositeComponents,
    ].flatMap((group) => Object.keys(group));
    // A name in two groups would collapse into one entry here.
    expect([...standardUI.components.keys()]).toEqual(groupNames);
    expect(standardUI.components.size).toBe(69);
    for (const [name, manifest] of Object.entries(
      standardUI.manifestComponents,
    )) {
      expect(manifest.description, name).toMatch(/\S/);
    }
  });

  it("has a manifest that survives a JSON round trip", () => {
    const manifest = standardUI.manifestComponents;
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });

  it("is used in full by the fixture", () => {
    const used = new Set(fixture.components.map((node) => node.component));
    const unused = [...standardUI.components.keys()].filter(
      (name) => !used.has(name),
    );
    expect(unused).toEqual([]);
  });

  it("renders the fixture with no error", async () => {
    const view = renderSurface(standardUI, fixture.components, fixture.data);
    expect(await view.findByText("Standard catalog fixture")).toBeTruthy();
    // Template rows, template list items, the Map list of places, and a
    // composite.
    expect(await view.findByText("Linus")).toBeTruthy();
    expect(await view.findByText("Café Central")).toBeTruthy();
    expect(await view.findByText("Walk dog")).toBeTruthy();
    expect(await view.findByText("Graz")).toBeTruthy();
    expect(view.reportError).not.toHaveBeenCalled();
  });
});

describe("catalog parameter order", () => {
  it.each([
    ["Text", ["text", "children"]],
    ["Column", ["children"]],
    ["Button", ["label", "onClick"]],
    ["TextField", ["label", "value"]],
    ["Chart", ["data", "xKey", "series", "chartType"]],
    ["FollowUp", ["items", "onFollowUp", "title"]],
  ] as const)("exports the standard %s calling convention", (name, prefix) => {
    const schema = exportA2UICatalog(standardUI).components[name];
    expect(Object.keys(schema.properties!).slice(1, prefix.length + 1)).toEqual(
      prefix,
    );
  });

  it("declares each of the 69 standard signatures completely and preserves schemas", () => {
    expect(standardUI.components.size).toBe(69);
    const exported = exportA2UICatalog(standardUI);
    for (const [name, manifest] of Object.entries(
      standardUI.manifestComponents,
    )) {
      const keys = [
        ...Object.keys(manifest.props.properties ?? {}),
        ...Object.keys(manifest.slots ?? {}),
        ...Object.keys(manifest.events ?? {}),
      ];
      expect(manifest.parameterOrder, name).toHaveLength(keys.length);
      expect(new Set(manifest.parameterOrder), name).toEqual(new Set(keys));
      expect(
        Object.keys(exported.components[name].properties!).slice(1),
        name,
      ).toEqual(manifest.parameterOrder);
      const definition = standardUI.components.get(name)!;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the rest is the definition without its order.
      const { parameterOrder: _order, ...withoutOrder } = definition;
      const original = createGenerativeUI({
        id: standardUI.id,
        components: { [name]: withoutOrder },
      });
      expect(exported.components[name], name).toEqual(
        exportA2UICatalog(original).components[name],
      );
    }
  });
});

describe("standardUI (Vue-specific semantics)", () => {
  /** A test-only card that marks its children, to tell it from the standard Card. */
  const MyCard = defineComponent({
    template: `<section data-testid="my-card"><slot name="children" /></section>`,
  });
  /** A test-only app component on top of the standard catalog. */
  const ProductCard = defineComponent({
    props: { name: { type: String, required: true } },
    template: `<article data-testid="product">{{ name }}</article>`,
  });

  const appUI = createGenerativeUI({
    id: "acme/app@1",
    extends: [standardUI.omit(["Map"])],
    overrides: { Card: { component: MyCard } },
    components: {
      ProductCard: {
        component: ProductCard,
        props: z.object({ name: z.string() }),
      },
    },
  });

  it("has the components of the shared standard declarations, in their order", () => {
    expect([...standardUI.components.keys()]).toEqual(
      Object.keys(standardDeclarations),
    );
  });

  it("extends standardUI without Map, with a Vue override and a Vue app component", async () => {
    expect(appUI.components.has("Map")).toBe(false);
    expect(appUI.components.has("Text")).toBe(true);
    const view = renderSurface(appUI, [
      { id: "root", component: "Card", children: ["p", "t"] },
      { id: "p", component: "ProductCard", name: "Desk lamp" },
      { id: "t", component: "Text", text: "In stock" },
    ]);
    const card = await view.findByTestId("my-card");
    expect(card.textContent).toContain("Desk lamp");
    expect(card.textContent).toContain("In stock");
    expect(view.reportError).not.toHaveBeenCalled();
  });

  it("keeps the standard parameter order of an overridden component", () => {
    expect(appUI.manifestComponents.Card.parameterOrder?.slice(0, 2)).toEqual([
      "children",
      "child",
    ]);
  });
});
