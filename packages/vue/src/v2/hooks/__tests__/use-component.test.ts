import { render, screen } from "@testing-library/vue";
import { defineComponent } from "vue";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { useComponent } from "../use-component";
import { useFrontendTool } from "../use-frontend-tool";

vi.mock("../use-frontend-tool", () => ({
  useFrontendTool: vi.fn(),
}));

const mockUseFrontendTool = useFrontendTool as ReturnType<typeof vi.fn>;

describe("useComponent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a component tool with generated default description", () => {
    const DemoComponent = defineComponent({
      props: {
        city: { type: String, required: true },
      },
      template: `<div>{{ city }}</div>`,
    });

    const Harness = defineComponent({
      setup() {
        useComponent({
          name: "showWeatherCard",
          render: DemoComponent,
        });
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    expect(mockUseFrontendTool).toHaveBeenCalledTimes(1);
    const [toolConfig] = mockUseFrontendTool.mock.calls[0] as [
      {
        name: string;
        description: string;
      },
    ];

    expect(toolConfig.name).toBe("showWeatherCard");
    expect(toolConfig.description).toContain(
      'Use this tool to display the "showWeatherCard" component in the chat.',
    );
  });

  it("appends custom description and forwards parameters, agentId, and deps", () => {
    const weatherSchema = z.object({
      city: z.string(),
      unit: z.enum(["c", "f"]),
    });

    const DemoComponent = defineComponent({
      props: {
        city: { type: String, required: true },
      },
      template: `<div>{{ city }}</div>`,
    });

    const deps = ["v1"] as const;

    const Harness = defineComponent({
      setup() {
        useComponent(
          {
            name: "showWeatherCard",
            description: "Render a weather card for the selected city.",
            parameters: weatherSchema,
            render: DemoComponent,
            agentId: "weather-agent",
          },
          deps as unknown as any[],
        );
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    expect(mockUseFrontendTool).toHaveBeenCalledTimes(1);
    const [toolConfig, forwardedDeps] = mockUseFrontendTool.mock.calls[0] as [
      {
        description: string;
        parameters: typeof weatherSchema;
        agentId?: string;
      },
      unknown[],
    ];

    expect(toolConfig.description).toContain(
      'Use this tool to display the "showWeatherCard" component in the chat.',
    );
    expect(toolConfig.description).toContain(
      "Render a weather card for the selected city.",
    );
    expect(toolConfig.parameters).toBe(weatherSchema);
    expect(toolConfig.agentId).toBe("weather-agent");
    expect(forwardedDeps).toBe(deps);
  });

  it("creates a render function that passes args into the component", () => {
    const DemoComponent = defineComponent({
      props: {
        city: { type: String, required: true },
      },
      template: `<div data-testid="city">{{ city }}</div>`,
    });

    const Harness = defineComponent({
      setup() {
        useComponent({
          name: "showWeatherCard",
          render: DemoComponent,
        });
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [toolConfig] = mockUseFrontendTool.mock.calls[0] as [
      {
        render: (props: { args: { city: string } }) => unknown;
      },
    ];

    const RenderHost = defineComponent({
      setup() {
        return () => toolConfig.render({ args: { city: "Paris" } });
      },
    });

    render(RenderHost);
    expect(screen.getByTestId("city").textContent).toBe("Paris");
  });
});
