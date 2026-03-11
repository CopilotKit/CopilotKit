import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { z } from "zod";
import { ToolCallStatus } from "@copilotkitnext/core";
import { defineToolCallRenderer } from "../defineToolCallRenderer";
import type { VueToolCallRenderer } from "../vue-tool-call-renderer";

describe("defineToolCallRenderer", () => {
  it("defaults wildcard args to z.any and preserves runtime tool name", () => {
    const wildcardRenderer = defineToolCallRenderer({
      name: "*",
      render: ({ name, args, status }) =>
        h("div", { "data-testid": "wildcard" }, `${name}:${status}:${JSON.stringify(args)}`),
    });

    expect(wildcardRenderer.name).toBe("*");
    expect(wildcardRenderer.args.safeParse({ anything: true }).success).toBe(true);

    const rendered = (wildcardRenderer.render as (props: {
      name: string;
      args: Record<string, unknown>;
      status: ToolCallStatus;
      result: string | undefined;
    }) => ReturnType<typeof h>)({
      name: "customTool",
      args: { x: 1 },
      status: ToolCallStatus.Executing,
      result: undefined,
    });

    expect(rendered.children).toContain("customTool");
    expect(rendered.children).not.toContain("*:");
  });

  it("supports mixed renderer arrays without type casts", () => {
    const wildcardRenderer = defineToolCallRenderer({
      name: "*",
      render: ({ name }) => h("div", `fallback:${name}`),
    });
    const weatherRenderer = defineToolCallRenderer({
      name: "get_weather",
      args: z.object({ location: z.string() }),
      render: ({ args }) => h("div", `weather:${args.location}`),
    });

    const renderers: VueToolCallRenderer<unknown>[] = [wildcardRenderer, weatherRenderer];
    expect(renderers).toHaveLength(2);
    expect(renderers[0]?.name).toBe("*");
    expect(renderers[1]?.name).toBe("get_weather");
  });

  it("accepts a Vue component as the renderer", () => {
    const ToolRenderer = defineComponent({
      props: {
        name: {
          type: String,
          required: true,
        },
        status: {
          type: String,
          required: true,
        },
      },
      template: `<div data-testid="component-renderer">{{ name }}:{{ status }}</div>`,
    });

    const componentRenderer = defineToolCallRenderer({
      name: "get_weather",
      args: z.object({ location: z.string() }),
      render: ToolRenderer,
    });

    expect(componentRenderer.render).toBe(ToolRenderer);
  });

  it("infers typed args shape for specific tools", () => {
    const typedRenderer = defineToolCallRenderer({
      name: "get_weather",
      args: z.object({
        location: z.string(),
        units: z.enum(["celsius", "fahrenheit"]).optional(),
      }),
      render: ({ args, status, result }) => {
        if (status === ToolCallStatus.InProgress) {
          const locationMaybe: string | undefined = args.location;
          return h("div", `loading:${locationMaybe ?? ""}`);
        }
        if (status === ToolCallStatus.Executing) {
          const location: string = args.location;
          return h("div", `executing:${location}`);
        }
        return h("div", `complete:${args.location}:${result}`);
      },
    });

    const rendered = (typedRenderer.render as (props: {
      name: string;
      args: { location: string; units?: "celsius" | "fahrenheit" };
      status: ToolCallStatus;
      result: string | undefined;
    }) => ReturnType<typeof h>)({
      name: "get_weather",
      args: { location: "Paris", units: "celsius" },
      status: ToolCallStatus.Executing,
      result: undefined,
    });

    expect(rendered.children).toContain("executing:Paris");
  });
});
