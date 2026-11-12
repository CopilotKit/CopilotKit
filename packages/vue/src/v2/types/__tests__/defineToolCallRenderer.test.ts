import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { z } from "zod";
import { ToolCallStatus } from "@copilotkit/core";
import type { VNode } from "vue";
import { defineToolCallRenderer } from "../defineToolCallRenderer";
import type {
  VueToolCallRenderer,
  VueToolCallRendererRenderProps,
} from "../vue-tool-call-renderer";

/**
 * Calls a renderer built from a render function. `render` is typed as a
 * function or a component, and TypeScript cannot tell which one this test
 * passed, so the narrowing cast lives here once.
 */
function callRender<T>(
  renderer: VueToolCallRenderer<T>,
  props: VueToolCallRendererRenderProps<T>,
) {
  const render = renderer.render as (
    props: VueToolCallRendererRenderProps<T>,
  ) => VNode;
  return render(props);
}

describe("defineToolCallRenderer", () => {
  it("defaults wildcard args to a schema that accepts any value and preserves runtime tool name", () => {
    const wildcardRenderer = defineToolCallRenderer({
      name: "*",
      render: ({ name, args, status }) =>
        h(
          "div",
          { "data-testid": "wildcard" },
          `${name}:${status}:${JSON.stringify(args)}`,
        ),
    });

    expect(wildcardRenderer.name).toBe("*");
    expect(
      wildcardRenderer.args["~standard"].validate({ anything: true }),
    ).toEqual({ value: { anything: true } });

    const rendered = callRender(wildcardRenderer, {
      name: "customTool",
      toolCallId: "tc-wildcard-1",
      args: { x: 1 },
      status: ToolCallStatus.Executing,
      result: undefined,
    });

    expect(rendered.children).toContain("customTool");
    expect(rendered.children).not.toContain("*:");
  });

  it("exposes toolCallId to wildcard renderers", () => {
    const wildcardRenderer = defineToolCallRenderer({
      name: "*",
      render: ({ name, toolCallId, status }) =>
        h(
          "div",
          { "data-testid": "wildcard" },
          `${name}:${toolCallId}:${status}`,
        ),
    });

    const rendered = callRender(wildcardRenderer, {
      name: "customTool",
      toolCallId: "tc-123",
      args: {},
      status: ToolCallStatus.InProgress,
      result: undefined,
    });

    expect(rendered.children).toContain("tc-123");
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

    const renderers: VueToolCallRenderer<unknown>[] = [
      wildcardRenderer,
      weatherRenderer,
    ];
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
      render: ({ args, toolCallId, status, result }) => {
        if (status === ToolCallStatus.InProgress) {
          const locationMaybe: string | undefined = args.location;
          return h("div", `loading:${toolCallId}:${locationMaybe ?? ""}`);
        }
        if (status === ToolCallStatus.Executing) {
          const location: string = args.location;
          return h("div", `executing:${toolCallId}:${location}`);
        }
        return h("div", `complete:${toolCallId}:${args.location}:${result}`);
      },
    });

    const rendered = callRender(typedRenderer, {
      name: "get_weather",
      toolCallId: "tc-weather-1",
      args: { location: "Paris", units: "celsius" },
      status: ToolCallStatus.Executing,
      result: undefined,
    });

    expect(rendered.children).toContain("executing:tc-weather-1:Paris");
  });
});
