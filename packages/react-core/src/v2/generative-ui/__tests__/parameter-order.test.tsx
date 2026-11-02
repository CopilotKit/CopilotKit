import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createGenerativeUI } from "../catalog";
import { exportA2UICatalog } from "../catalog-export";
import { standardUI } from "../standard";

const View = () => null;
const action = { parameters: z.object({}) };

describe("catalog parameter order", () => {
  it.each(["0", "1", "4294967294"])(
    "rejects integer-index key %s even outside the positional prefix",
    (key) => {
      expect(() =>
        createGenerativeUI({
          id: "numeric@1",
          components: {
            Numeric: {
              component: View,
              props: z.object({ label: z.string(), [key]: z.string() }),
              parameterOrder: ["label"],
            },
          },
        }),
      ).toThrow(/integer-index.*JSON object/i);
    },
  );

  it("keeps unordered numeric keys and ordered non-index names supported", () => {
    const unordered = createGenerativeUI({
      id: "numeric@1",
      components: {
        Numeric: { component: View, props: z.object({ "0": z.string() }) },
      },
    });
    expect(
      exportA2UICatalog(unordered).components.Numeric.properties,
    ).toHaveProperty("0");
    const ordered = createGenerativeUI({
      id: "named@1",
      components: {
        Named: {
          component: View,
          props: z.object({ "01": z.string(), "4294967295": z.string() }),
          parameterOrder: ["4294967295", "01"],
        },
      },
    });
    expect(
      Object.keys(exportA2UICatalog(ordered).components.Named.properties!),
    ).toEqual(["component", "4294967295", "01"]);
  });

  it("orders props, slots and events together without changing their schemas", () => {
    const definition = {
      component: View,
      props: z.object({ color: z.string().optional(), label: z.string() }),
      slots: { children: "multiple" as const },
      events: { onClick: action },
    };
    const unordered = createGenerativeUI({
      id: "test@1",
      components: { Button: definition },
    });
    const ordered = createGenerativeUI({
      id: "test@1",
      components: {
        Button: {
          ...definition,
          parameterOrder: ["label", "onClick", "children"],
        },
      },
    });
    expect(ordered.manifestComponents.Button.parameterOrder).toEqual([
      "label",
      "onClick",
      "children",
      "color",
    ]);
    const before = exportA2UICatalog(unordered).components.Button;
    const after = JSON.parse(JSON.stringify(exportA2UICatalog(ordered)))
      .components.Button;
    expect(after).toEqual(before);
    expect(Object.keys(after.properties)).toEqual([
      "component",
      "label",
      "onClick",
      "children",
      "color",
    ]);
    expect(unordered.manifestComponents.Button.parameterOrder).toBeUndefined();
    expect(Object.keys(before.properties!)).toEqual([
      "component",
      "color",
      "label",
      "onClick",
      "children",
    ]);
  });

  it.each([["label", "label"], ["missing"]])(
    "rejects invalid ordering %j",
    (...parameterOrder) => {
      expect(() =>
        createGenerativeUI({
          id: "invalid@1",
          components: {
            Button: {
              component: View,
              props: z.object({ label: z.string() }),
              parameterOrder,
            },
          },
        }),
      ).toThrow(/parameterOrder/);
    },
  );

  it("retains declarations through extends/omit/overrides and removes newly bound keys", () => {
    const base = createGenerativeUI({
      id: "base@1",
      components: {
        Button: {
          component: View,
          props: z.object({ label: z.string(), color: z.string() }),
          events: { onClick: action },
          parameterOrder: ["label", "onClick", "color"],
        },
        Other: { component: View },
      },
    });
    const derived = createGenerativeUI({
      id: "derived@1",
      extends: [base.omit(["Other"])],
      state: { label: z.string() },
      functions: { onClick: action },
      overrides: { Button: { component: View } },
      components: {},
    });
    expect(derived.manifestComponents.Button.parameterOrder).toEqual(["color"]);
    expect(derived.manifestComponents.Other).toBeUndefined();
    expect(base.manifestComponents.Button.parameterOrder).toEqual([
      "label",
      "onClick",
      "color",
    ]);
    expect(derived.components.get("Button")!.parameterOrder).toEqual([
      "label",
      "onClick",
      "color",
    ]);
  });

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
