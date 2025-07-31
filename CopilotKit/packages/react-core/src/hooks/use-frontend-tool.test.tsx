import React from "react";
import { renderHook } from "@testing-library/react-hooks";
import { useFrontendTool } from "./use-frontend-tool";
import { z } from "zod";

// Mock useCopilotAction
jest.mock("./use-copilot-action", () => ({
  useCopilotAction: jest.fn(),
}));

import { useCopilotAction } from "./use-copilot-action";

describe("useFrontendTool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should convert Zod schema to JSON Schema and call useCopilotAction", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const tool = {
      name: "testTool",
      description: "Test tool",
      parameters: schema,
      handler: async (args: { name: string; age: number }) => {
        return `Hello ${args.name}, you are ${args.age} years old`;
      },
    };

    renderHook(() => useFrontendTool(tool));

    expect(useCopilotAction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "testTool",
        description: "Test tool",
        handler: tool.handler,
        jsonSchema: expect.stringContaining('"type":"object"'),
        parameters: undefined,
      }),
      undefined
    );
  });

  it("should work without parameters", () => {
    const tool = {
      name: "simpleTest",
      description: "Simple test",
      handler: async () => {
        return "Done";
      },
    };

    renderHook(() => useFrontendTool(tool));

    expect(useCopilotAction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "simpleTest",
        description: "Simple test",
        handler: tool.handler,
        jsonSchema: undefined,
        parameters: undefined,
      }),
      undefined
    );
  });

  it("should pass dependencies correctly", () => {
    const tool = {
      name: "depTest",
      handler: async () => "test",
    };
    const deps = ["dep1", "dep2"];

    renderHook(() => useFrontendTool(tool, deps));

    expect(useCopilotAction).toHaveBeenCalledWith(
      expect.any(Object),
      deps
    );
  });

  it("should convert render function to match FrontendAction format", () => {
    const RenderComponent: React.ComponentType<any> = ({ name, args, status }) => (
      <div>{name} - {args?.test} - {status}</div>
    );

    const tool = {
      name: "renderTest",
      parameters: z.object({ test: z.string() }),
      render: RenderComponent,
    };

    renderHook(() => useFrontendTool(tool));

    const calledAction = (useCopilotAction as jest.Mock).mock.calls[0][0];
    expect(calledAction.render).toBeDefined();
    
    // Test the render function wrapper
    const rendered = calledAction.render({
      args: { test: "value" },
      status: "executing",
    });

    expect(rendered.type).toBe(RenderComponent);
    expect(rendered.props).toEqual({
      name: "renderTest",
      description: "",
      args: { test: "value" },
      status: "executing",
      result: undefined,
    });
  });
});