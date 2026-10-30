import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, expectTypeOf, beforeEach, vi } from "vitest";
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
        render: DemoComponent,
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

  it("appends custom description and forwards parameters, agentId, deps, and followUp", () => {
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
          render: DemoComponent,
          agentId: "weather-agent",
          followUp: false,
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
        followUp?: boolean;
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
    expect(toolConfig.followUp).toBe(false);
    expect(forwardedDeps).toBe(deps);
  });

  it("creates a render function that passes args into the component", () => {
    const DemoComponent: React.FC<{ city: string }> = ({ city }) => (
      <div data-testid="city">{city}</div>
    );

    const Harness: React.FC = () => {
      useComponent({
        name: "showWeatherCard",
        render: DemoComponent,
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

  type RenderFn = (props: {
    args: Record<string, unknown>;
    status: string;
  }) => React.ReactElement;

  function registerAndGetRender(Component: React.ComponentType<any>): RenderFn {
    const Harness: React.FC = () => {
      useComponent({ name: "showWeatherCard", render: Component });
      return null;
    };
    render(<Harness />);
    const [toolConfig] = mockUseFrontendTool.mock.calls[0] as [
      { render: RenderFn },
    ];
    return toolConfig.render;
  }

  it("passes the tool call status as toolCallStatus alongside the args", () => {
    const seen: unknown[] = [];
    const DemoComponent: React.FC<{
      city?: string;
      toolCallStatus?: string;
    }> = (props) => {
      seen.push(props);
      return <div data-testid="status">{props.toolCallStatus}</div>;
    };

    const renderTool = registerAndGetRender(DemoComponent);

    const { getByTestId, rerender } = render(
      renderTool({ args: { city: "Pa" }, status: "inProgress" }),
    );
    expect(getByTestId("status").textContent).toBe("inProgress");

    rerender(renderTool({ args: { city: "Paris" }, status: "complete" }));
    expect(getByTestId("status").textContent).toBe("complete");
    expect(seen.at(-1)).toEqual({ city: "Paris", toolCallStatus: "complete" });
  });

  it("lets a parameter named toolCallStatus win, so existing props keep their value", () => {
    const DemoComponent: React.FC<{ toolCallStatus?: string }> = ({
      toolCallStatus,
    }) => <div data-testid="status">{toolCallStatus}</div>;

    const renderTool = registerAndGetRender(DemoComponent);

    const { getByTestId } = render(
      renderTool({
        args: { toolCallStatus: "from-agent" },
        status: "executing",
      }),
    );
    expect(getByTestId("status").textContent).toBe("from-agent");
  });

  it("renders nothing when the component throws on partial args, and keeps the app mounted", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const NestedCard: React.FC<{ user?: { address: { city: string } } }> = ({
      user,
    }) => <div data-testid="card">{user!.address.city}</div>;

    const renderTool = registerAndGetRender(NestedCard);

    const App: React.FC<{ args: Record<string, unknown>; status: string }> = ({
      args,
      status,
    }) => (
      <div>
        <div data-testid="app">app</div>
        {renderTool({ args, status })}
      </div>
    );

    const { getByTestId, queryByTestId, rerender } = render(
      <App args={{ user: {} }} status="inProgress" />,
    );
    expect(getByTestId("app").textContent).toBe("app");
    expect(queryByTestId("card")).toBeNull();

    // Once the arguments finish streaming, the component renders again.
    rerender(
      <App args={{ user: { address: { city: "Paris" } } }} status="complete" />,
    );
    expect(getByTestId("card").textContent).toBe("Paris");
    consoleError.mockRestore();
  });

  it("types toolCallStatus for inline renders and still accepts schema-only components", () => {
    const schema = z.object({ city: z.string() });
    const SchemaOnly: React.FC<z.infer<typeof schema>> = ({ city }) => (
      <div>{city}</div>
    );

    const Harness: React.FC = () => {
      useComponent({
        name: "inline",
        parameters: schema,
        render: ({ city, toolCallStatus }) => {
          expectTypeOf(toolCallStatus).toEqualTypeOf<
            "inProgress" | "executing" | "complete" | undefined
          >();
          return <div>{toolCallStatus === "complete" ? city : "…"}</div>;
        },
      });
      useComponent({
        name: "schemaOnly",
        parameters: schema,
        render: SchemaOnly,
      });
      return null;
    };

    render(<Harness />);
    expect(mockUseFrontendTool).toHaveBeenCalledTimes(2);
  });
});
