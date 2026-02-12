import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { z } from "zod";
import { defineToolCallRenderer } from "../defineToolCallRenderer";
import { ToolCallStatus } from "@copilotkitnext/core";
import type { ReactToolCallRenderer } from "../react-tool-call-renderer";
import { CopilotKitProvider } from "@/providers/CopilotKitProvider";
import { AbstractAgent } from "@ag-ui/client";

describe("defineToolCallRenderer", () => {
  describe("Array compatibility", () => {
    it("should work with multiple tool renders in an array", () => {
      // This test verifies that multiple tool renders with different arg types
      // can be used together in the renderToolCalls array
      const WildCardRender = defineToolCallRenderer({
        name: "*",
        render: ({ args, result, name, status }) => {
          return <div>Wildcard: {name}</div>;
        },
      });

      const OtherToolRender = defineToolCallRenderer({
        name: "get_weather",
        args: z.object({
          location: z.string(),
        }),
        render: ({ args, result, name, status }) => {
          return <div>Weather in {args.location}</div>;
        },
      });

      // This should compile without errors
      // Testing that mixed types can be used together
      const renderToolCalls = [WildCardRender, OtherToolRender];

      expect(renderToolCalls).toHaveLength(2);
      expect(renderToolCalls[0]!.name).toBe("*");
      expect(renderToolCalls[1]!.name).toBe("get_weather");

      // Verify they have the expected structure
      expect(renderToolCalls[0]!.render).toBeDefined();
      expect(renderToolCalls[1]!.render).toBeDefined();
      expect(renderToolCalls[1]!.args).toBeDefined();
    });

    it("should work with CopilotKitProvider accepting mixed tool renders", () => {
      // This is the exact scenario the user reported
      const WildCardRender = defineToolCallRenderer({
        name: "*",
        render: ({ args, result, name, status }) => {
          return <div data-testid="wildcard">TODO: {name}</div>;
        },
      });

      const OtherToolRender = defineToolCallRenderer({
        name: "get_weather",
        args: z.object({
          location: z.string(),
        }),
        render: ({ args, result, name, status }) => {
          return <div data-testid="weather">Weather for {args.location}</div>;
        },
      });

      // This should compile without type errors
      const TestComponent = () => {
        const renderToolCalls = [WildCardRender, OtherToolRender];

        // In real usage, this would be passed to CopilotKitProvider
        // We're just checking that the type is compatible
        const providerProps: { renderToolCalls?: ReactToolCallRenderer<any>[] } =
          {
            renderToolCalls: renderToolCalls,
          };

        return <div data-testid="test">Test</div>;
      };

      const { getByTestId } = render(<TestComponent />);
      expect(getByTestId("test")).toBeDefined();
    });

    it("should work with actual CopilotKitProvider - replicating user's exact scenario", () => {
      // Exact replication of the user's code that was causing type errors
      const WildCardRender = defineToolCallRenderer({
        name: "*",
        render: ({ args, result, name, status }) => {
          return <div>TODO</div>;
        },
      });

      const OtherToolRender = defineToolCallRenderer({
        name: "get_weather",
        args: z.object({
          location: z.string(),
        }),
        render: ({ args, result, name, status }) => {
          return <div>TODO</div>;
        },
      });

      // Create a mock agent for testing
      const mockAgent = {
        clone: vi.fn(),
        run: vi.fn(),
        subscribe: vi.fn(() => ({ unsubscribe: () => {} })),
      } as unknown as AbstractAgent;

      // This is the exact code pattern the user wanted to use
      // Previously this would cause a type error, now it should compile
      const TestApp = () => (
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            default: mockAgent,
          }}
          renderToolCalls={[WildCardRender, OtherToolRender]}
        >
          <div data-testid="app">App content</div>
        </CopilotKitProvider>
      );

      // If this renders without TypeScript errors, the fix is working
      const { getByTestId } = render(<TestApp />);
      expect(getByTestId("app")).toBeDefined();
      expect(getByTestId("app").textContent).toBe("App content");
    });
  });
  describe("Type inference and rendering", () => {
    it("should properly infer types for regular tools", () => {
      const weatherRender = defineToolCallRenderer({
        name: "get_weather",
        args: z.object({
          location: z.string(),
          units: z.enum(["celsius", "fahrenheit"]).optional(),
        }),
        render: ({ args, status, name, result }) => {
          // Test that types are properly inferred
          if (status === ToolCallStatus.InProgress) {
            // args should be Partial
            const loc: string | undefined = args.location;
            return <div data-testid="progress">Loading {loc || "..."}...</div>;
          }

          if (status === ToolCallStatus.Executing) {
            // args should be complete
            const loc: string = args.location;
            return (
              <div data-testid="executing">Fetching weather for {loc}</div>
            );
          }

          // Complete status
          return (
            <div data-testid="complete">
              Weather in {args.location}: {result}
            </div>
          );
        },
      });

      // Test InProgress state
      const ProgressComponent = weatherRender.render as React.FC<any>;
      const { rerender } = render(
        <ProgressComponent
          name="get_weather"
          args={{ location: "Paris" }}
          status={ToolCallStatus.InProgress}
          result={undefined}
        />
      );
      expect(screen.getByTestId("progress").textContent).toBe(
        "Loading Paris..."
      );

      // Test Executing state
      rerender(
        <ProgressComponent
          name="get_weather"
          args={{ location: "London", units: "celsius" }}
          status={ToolCallStatus.Executing}
          result={undefined}
        />
      );
      expect(screen.getByTestId("executing").textContent).toBe(
        "Fetching weather for London"
      );

      // Test Complete state
      rerender(
        <ProgressComponent
          name="get_weather"
          args={{ location: "Tokyo", units: "fahrenheit" }}
          status={ToolCallStatus.Complete}
          result="Sunny, 75°F"
        />
      );
      expect(screen.getByTestId("complete").textContent).toBe(
        "Weather in Tokyo: Sunny, 75°F"
      );
    });

    it("should work with wildcard tool without args definition", () => {
      // No args field - should default to z.any()
      const wildcardRender = defineToolCallRenderer({
        name: "*",
        render: ({ name, args, status }) => (
          <div data-testid="wildcard">
            <span data-testid="tool-name">{name}</span>
            <span data-testid="status">{status}</span>
            <span data-testid="args">{JSON.stringify(args)}</span>
          </div>
        ),
      });

      const WildcardComponent = wildcardRender.render as React.FC<any>;

      // Test that wildcard receives actual tool name, not "*"
      render(
        <WildcardComponent
          name="customTool"
          args={{ param1: "value1", param2: 42 }}
          status={ToolCallStatus.Executing}
          result={undefined}
        />
      );

      expect(screen.getByTestId("tool-name").textContent).toBe("customTool");
      expect(screen.getByTestId("tool-name").textContent).not.toBe("*");
      expect(screen.getByTestId("status").textContent).toBe("executing");

      const argsText = screen.getByTestId("args").textContent || "";
      expect(argsText).toContain("value1");
      expect(argsText).toContain("42");
    });

    it("should handle complex nested schemas", () => {
      const complexRender = defineToolCallRenderer({
        name: "complex_tool",
        args: z.object({
          user: z.object({
            id: z.number(),
            name: z.string(),
            email: z.string().email(),
          }),
          options: z.array(z.string()),
          metadata: z.record(z.unknown()).optional(),
        }),
        render: ({ args, status }) => {
          if (status === ToolCallStatus.Executing) {
            return (
              <div data-testid="complex">
                <div data-testid="user-info">
                  User: {args.user.name} ({args.user.email})
                </div>
                <div data-testid="options">
                  Options: {args.options.join(", ")}
                </div>
                {args.metadata && (
                  <div data-testid="metadata">
                    Metadata keys: {Object.keys(args.metadata).join(", ")}
                  </div>
                )}
              </div>
            );
          }
          return <div>Processing...</div>;
        },
      });

      const ComplexComponent = complexRender.render as React.FC<any>;
      render(
        <ComplexComponent
          name="complex_tool"
          args={{
            user: { id: 1, name: "John Doe", email: "john@example.com" },
            options: ["option1", "option2", "option3"],
            metadata: { key1: "value1", key2: "value2" },
          }}
          status={ToolCallStatus.Executing}
          result={undefined}
        />
      );

      expect(screen.getByTestId("user-info").textContent).toBe(
        "User: John Doe (john@example.com)"
      );
      expect(screen.getByTestId("options").textContent).toBe(
        "Options: option1, option2, option3"
      );
      expect(screen.getByTestId("metadata").textContent).toBe(
        "Metadata keys: key1, key2"
      );
    });

    it("should properly handle all status states in union", () => {
      const unionTestRender = defineToolCallRenderer({
        name: "union_test",
        args: z.object({
          value: z.string(),
        }),
        render: (props) => {
          switch (props.status) {
            case ToolCallStatus.InProgress:
              return (
                <div data-testid="in-progress">
                  In Progress: {props.args.value || "..."}
                </div>
              );
            case ToolCallStatus.Executing:
              return (
                <div data-testid="executing">Executing: {props.args.value}</div>
              );
            case ToolCallStatus.Complete:
              return (
                <div data-testid="complete">
                  Complete: {props.args.value} = {props.result}
                </div>
              );
            default:
              return <div data-testid="unknown">Unknown status</div>;
          }
        },
      });

      const UnionComponent = unionTestRender.render as React.FC<any>;
      const { rerender } = render(
        <UnionComponent
          name="union_test"
          args={{ value: "partial" }}
          status={ToolCallStatus.InProgress}
          result={undefined}
        />
      );
      expect(screen.getByTestId("in-progress").textContent).toBe(
        "In Progress: partial"
      );

      rerender(
        <UnionComponent
          name="union_test"
          args={{ value: "test" }}
          status={ToolCallStatus.Executing}
          result={undefined}
        />
      );
      expect(screen.getByTestId("executing").textContent).toBe(
        "Executing: test"
      );

      rerender(
        <UnionComponent
          name="union_test"
          args={{ value: "test" }}
          status={ToolCallStatus.Complete}
          result="success"
        />
      );
      expect(screen.getByTestId("complete").textContent).toBe(
        "Complete: test = success"
      );
    });

    it("should support agentId parameter", () => {
      const agentSpecificRender = defineToolCallRenderer({
        name: "agent_tool",
        args: z.object({ message: z.string() }),
        agentId: "special-agent",
        render: ({ args }) => <div data-testid="agent">{args.message}</div>,
      });

      expect(agentSpecificRender.agentId).toBe("special-agent");
      expect(agentSpecificRender.name).toBe("agent_tool");
    });

    it("should work with wildcard and agentId", () => {
      const agentWildcard = defineToolCallRenderer({
        name: "*",
        agentId: "fallback-agent",
        render: ({ name }) => (
          <div data-testid="wildcard-agent">Unknown: {name}</div>
        ),
      });

      expect(agentWildcard.agentId).toBe("fallback-agent");
      expect(agentWildcard.name).toBe("*");

      const Component = agentWildcard.render as React.FC<any>;
      render(
        <Component
          name="unknownTool"
          args={{ anything: "goes" }}
          status={ToolCallStatus.Executing}
          result={undefined}
        />
      );

      expect(screen.getByTestId("wildcard-agent").textContent).toBe(
        "Unknown: unknownTool"
      );
    });
  });

  describe("Real-world use cases", () => {
    it("should handle the user's original weather example without type errors", () => {
      // This is the exact code the user reported was causing errors
      const weatherRender = defineToolCallRenderer({
        name: "get_weather",
        args: z.object({
          location: z.string(),
        }),
        render: ({ args }) => {
          // No type casting needed - TypeScript infers correctly
          return <div data-testid="weather">Weather: {args.location}</div>;
        },
      });

      const Component = weatherRender.render as React.FC<any>;
      render(
        <Component
          name="get_weather"
          args={{ location: "San Francisco" }}
          status={ToolCallStatus.Executing}
          result={undefined}
        />
      );

      expect(screen.getByTestId("weather").textContent).toBe(
        "Weather: San Francisco"
      );
    });

    it("should allow wildcard as fallback for undefined tools", () => {
      const renders = [
        defineToolCallRenderer({
          name: "known_tool",
          args: z.object({ id: z.number() }),
          render: ({ args }) => (
            <div data-testid="known">Known tool: {args.id}</div>
          ),
        }),
        defineToolCallRenderer({
          name: "*",
          render: ({ name, args }) => (
            <div data-testid="fallback">
              Fallback for {name}: {JSON.stringify(args)}
            </div>
          ),
        }),
      ];

      // Test known tool
      const KnownComponent = renders[0]!.render as React.FC<any>;
      const { rerender } = render(
        <KnownComponent
          name="known_tool"
          args={{ id: 123 }}
          status={ToolCallStatus.Executing}
          result={undefined}
        />
      );
      expect(screen.getByTestId("known").textContent).toBe("Known tool: 123");

      // Test wildcard fallback
      const WildcardComponent = renders[1]!.render as React.FC<any>;
      rerender(
        <WildcardComponent
          name="unknown_tool"
          args={{ data: "test" }}
          status={ToolCallStatus.Executing}
          result={undefined}
        />
      );
      expect(screen.getByTestId("fallback").textContent).toBe(
        'Fallback for unknown_tool: {"data":"test"}'
      );
    });

    it("should handle optional fields correctly", () => {
      const optionalRender = defineToolCallRenderer({
        name: "optional_test",
        args: z.object({
          required: z.string(),
          optional: z.string().optional(),
          nullable: z.string().nullable(),
          defaulted: z.string().default("default_value"),
        }),
        render: ({ args, status }) => {
          if (status === ToolCallStatus.Executing) {
            return (
              <div data-testid="optional">
                <div>Required: {args.required}</div>
                <div>Optional: {args.optional || "not provided"}</div>
                <div>Nullable: {args.nullable || "null"}</div>
                <div>Defaulted: {args.defaulted}</div>
              </div>
            );
          }
          return <div>Loading...</div>;
        },
      });

      const Component = optionalRender.render as React.FC<any>;
      render(
        <Component
          name="optional_test"
          args={{
            required: "test",
            nullable: null,
            defaulted: "custom",
          }}
          status={ToolCallStatus.Executing}
          result={undefined}
        />
      );

      const element = screen.getByTestId("optional");
      expect(element.textContent).toContain("Required: test");
      expect(element.textContent).toContain("Optional: not provided");
      expect(element.textContent).toContain("Nullable: null");
      expect(element.textContent).toContain("Defaulted: custom");
    });
  });
});
