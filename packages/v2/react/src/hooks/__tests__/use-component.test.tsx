import React from "react";
import { render } from "@testing-library/react";
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
    const DemoComponent: React.FC<{ city: string }> = ({ city }) => (
      <div>{city}</div>
    );

    const Harness: React.FC = () => {
      useComponent({
        name: "showWeatherCard",
        component: DemoComponent,
      });
      return null;
    };

    render(<Harness />);

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

    const DemoComponent: React.FC<z.infer<typeof weatherSchema>> = ({
      city,
    }) => <div>{city}</div>;

    const deps = ["v1"] as const;

    const Harness: React.FC = () => {
      useComponent(
        {
          name: "showWeatherCard",
          description: "Render a weather card for the selected city.",
          parameters: weatherSchema,
          component: DemoComponent,
          agentId: "weather-agent",
        },
        deps,
      );
      return null;
    };

    render(<Harness />);

    expect(mockUseFrontendTool).toHaveBeenCalledTimes(1);
    const [toolConfig, forwardedDeps] = mockUseFrontendTool.mock.calls[0] as [
      {
        description: string;
        parameters: typeof weatherSchema;
        agentId?: string;
      },
      ReadonlyArray<unknown>,
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
    const DemoComponent: React.FC<{ city: string }> = ({ city }) => (
      <div data-testid="city">{city}</div>
    );

    const Harness: React.FC = () => {
      useComponent({
        name: "showWeatherCard",
        component: DemoComponent,
      });
      return null;
    };

    render(<Harness />);

    const [toolConfig] = mockUseFrontendTool.mock.calls[0] as [
      {
        render: (props: { args: { city: string } }) => React.ReactElement;
      },
    ];

    const { getByTestId } = render(
      toolConfig.render({ args: { city: "Paris" } }),
    );
    expect(getByTestId("city").textContent).toBe("Paris");
  });
});
