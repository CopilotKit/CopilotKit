import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderHook } from "@testing-library/react";

// Mock CopilotKit hooks -- these must be mocked before importing the module
const mockUseAgentContext = vi.fn();
vi.mock("@copilotkit/react-core", () => ({
  useAgentContext: (...args: unknown[]) => mockUseAgentContext(...args),
}));

vi.mock("@copilotkit/react-ui", () => ({
  // RenderMessageProps is a type, no runtime value needed
}));

vi.mock("@ag-ui/core", () => ({
  // AssistantMessage is a type, no runtime value needed
}));

// We need to check if hashbrown packages are available for testing.
// These tests verify the kit definition compiles and components render correctly.
// Since hashbrown is a beta dependency, we mock it for unit tests.
vi.mock("@hashbrownai/core", () => {
  const s = {
    string: (desc?: string) => ({
      _type: "string",
      _desc: desc,
      optional: () => ({ _type: "string", _optional: true, _desc: desc }),
      default: (v: string) => ({ _type: "string", _default: v, _desc: desc }),
    }),
    number: (desc?: string) => ({
      _type: "number",
      _desc: desc,
      optional: () => ({ _type: "number", _optional: true, _desc: desc }),
    }),
    object: (shape: Record<string, unknown>) => ({
      _type: "object",
      _shape: shape,
    }),
    streaming: {
      array: (item: unknown) => ({ _type: "streaming_array", _item: item }),
      string: (desc?: string) => ({ _type: "streaming_string", _desc: desc }),
    },
    toJsonSchema: (schema: unknown) => ({
      type: "object",
      properties: {},
      _source: schema,
    }),
  };

  function prompt(strings: TemplateStringsArray, ..._values: unknown[]) {
    return strings.join("");
  }

  return { s, prompt };
});

vi.mock("@hashbrownai/react", () => {
  function exposeMarkdown() {
    return { _type: "markdown" };
  }

  function exposeComponent(
    component: unknown,
    options: {
      name: string;
      props: Record<string, unknown>;
      description?: string;
    },
  ) {
    return {
      _type: "component",
      _component: component,
      _name: options.name,
      _props: options.props,
    };
  }

  function useUiKit(options: { examples: string; components: unknown[] }) {
    return {
      schema: { _components: options.components, _examples: options.examples },
      render: (value: unknown) => {
        // Simple mock render -- returns a div with the JSON value
        const React = require("react");
        return React.createElement(
          "div",
          { "data-testid": "kit-render" },
          JSON.stringify(value),
        );
      },
    };
  }

  function useJsonParser(content: string, _schema: unknown) {
    try {
      const parsed = JSON.parse(content);
      return { value: parsed, parserState: { isComplete: true } };
    } catch {
      return { value: null, parserState: { isComplete: false } };
    }
  }

  return { exposeMarkdown, exposeComponent, useUiKit, useJsonParser };
});

// Now import the module under test
import { useSalesDashboardKit, HashBrownDashboard } from "../hashbrown";

describe("HashBrown renderer adapter", () => {
  describe("useSalesDashboardKit", () => {
    it("returns a kit with schema and render function", () => {
      const { result } = renderHook(() => useSalesDashboardKit());
      expect(result.current.schema).toBeDefined();
      expect(typeof result.current.render).toBe("function");
    });

    it("schema contains registered components", () => {
      const { result } = renderHook(() => useSalesDashboardKit());
      const schema = result.current.schema as {
        _components: { _name: string }[];
      };
      const names = schema._components
        .filter((c: { _name?: string }) => c._name)
        .map((c: { _name: string }) => c._name);
      expect(names).toContain("metric");
      expect(names).toContain("pieChart");
      expect(names).toContain("barChart");
      expect(names).toContain("dealCard");
    });

    it("schema includes markdown component", () => {
      const { result } = renderHook(() => useSalesDashboardKit());
      const schema = result.current.schema as {
        _components: { _type: string }[];
      };
      const hasMarkdown = schema._components.some(
        (c: { _type: string }) => c._type === "markdown",
      );
      expect(hasMarkdown).toBe(true);
    });

    it("schema includes few-shot examples", () => {
      const { result } = renderHook(() => useSalesDashboardKit());
      const schema = result.current.schema as { _examples: string };
      expect(schema._examples).toContain("metric");
      expect(schema._examples).toContain("pieChart");
      expect(schema._examples).toContain("barChart");
      expect(schema._examples).toContain("dealCard");
    });

    it("kit has exactly 5 components (markdown + metric + pieChart + barChart + dealCard)", () => {
      const { result } = renderHook(() => useSalesDashboardKit());
      const schema = result.current.schema as { _components: unknown[] };
      expect(schema._components).toHaveLength(5);
    });
  });

  describe("kit.render", () => {
    it("renders mock value through kit.render", () => {
      const { result } = renderHook(() => useSalesDashboardKit());
      const mockValue = { type: "metric", label: "Revenue", value: "$1M" };

      const { container } = render(
        result.current.render(mockValue) as React.ReactElement,
      );
      const rendered = container.querySelector("[data-testid='kit-render']");
      expect(rendered).toBeTruthy();
      expect(rendered!.textContent).toContain("Revenue");
    });
  });

  describe("HashBrownDashboard", () => {
    it("renders children", () => {
      render(
        <HashBrownDashboard>
          <div data-testid="child">Hello</div>
        </HashBrownDashboard>,
      );
      expect(screen.getByTestId("child")).toBeTruthy();
      expect(screen.getByText("Hello")).toBeTruthy();
    });

    it("forwards output_schema to agent context", () => {
      mockUseAgentContext.mockReset();
      render(
        <HashBrownDashboard>
          <span>test</span>
        </HashBrownDashboard>,
      );

      // HashBrownDashboard calls useAgentContext with output_schema
      const outputSchemaCall = mockUseAgentContext.mock.calls.find(
        (call: unknown[]) =>
          (call[0] as { description: string }).description === "output_schema",
      );
      expect(outputSchemaCall).toBeTruthy();
      // The value should be the toJsonSchema result
      const schemaValue = (outputSchemaCall![0] as { value: unknown }).value;
      expect(schemaValue).toBeDefined();
      expect((schemaValue as { type: string }).type).toBe("object");
    });

    it("renders without children (no crash on undefined children)", () => {
      const { container } = render(<HashBrownDashboard />);
      // Should render an empty fragment
      expect(container).toBeTruthy();
    });
  });
});
