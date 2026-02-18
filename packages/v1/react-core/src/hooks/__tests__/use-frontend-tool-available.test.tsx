import { vi } from "vitest";
import React from "react";
import { render, waitFor } from "@testing-library/react";
import { useFrontendTool } from "../use-frontend-tool";

// Track what gets passed to the v2 hook
let lastV2ToolCall: any = null;

vi.mock("@copilotkitnext/react", () => ({
  useFrontendTool: vi.fn((tool: any) => {
    lastV2ToolCall = tool;
  }),
}));

describe("useFrontendTool available passthrough (v1 → v2)", () => {
  beforeEach(() => {
    lastV2ToolCall = null;
  });

  it("converts available: 'disabled' to false for v2", () => {
    const Component: React.FC = () => {
      useFrontendTool({
        name: "testTool",
        description: "Test tool",
        available: "disabled",
        parameters: [],
        handler: async () => "done",
      });
      return null;
    };

    render(<Component />);

    expect(lastV2ToolCall).toBeDefined();
    expect(lastV2ToolCall.available).toBe(false);
  });

  it("converts available: 'enabled' to true for v2", () => {
    const Component: React.FC = () => {
      useFrontendTool({
        name: "testTool",
        description: "Test tool",
        available: "enabled",
        parameters: [],
        handler: async () => "done",
      });
      return null;
    };

    render(<Component />);

    expect(lastV2ToolCall).toBeDefined();
    expect(lastV2ToolCall.available).toBe(true);
  });

  it("does not include available when not specified", () => {
    const Component: React.FC = () => {
      useFrontendTool({
        name: "testTool",
        description: "Test tool",
        parameters: [],
        handler: async () => "done",
      });
      return null;
    };

    render(<Component />);

    expect(lastV2ToolCall).toBeDefined();
    expect(lastV2ToolCall.available).toBeUndefined();
  });
});
