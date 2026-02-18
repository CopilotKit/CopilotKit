import React, { useState, useEffect } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { z } from "zod";
import { useFrontendTool } from "../use-frontend-tool";
import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { ReactFrontendTool } from "@/types";
import { CopilotKitCoreReact } from "@/lib/react-core";
import { renderWithCopilotKit } from "@/__tests__/utils/test-helpers";

/**
 * Component that captures the copilotkit core ref for test assertions.
 */
const CoreCapture: React.FC<{
  onCore: (core: CopilotKitCoreReact) => void;
}> = ({ onCore }) => {
  const { copilotkit } = useCopilotKit();
  useEffect(() => {
    onCore(copilotkit);
  }, [copilotkit, onCore]);
  return null;
};

describe("useFrontendTool available flag", () => {
  it("registers tool with available: false on the core", async () => {
    let coreRef: CopilotKitCoreReact | null = null;

    const ToolComponent: React.FC = () => {
      const tool: ReactFrontendTool<{ msg: string }> = {
        name: "disabledTool",
        description: "A disabled tool",
        available: false,
        parameters: z.object({ msg: z.string() }),
        handler: async () => ({ result: "ok" }),
      };
      useFrontendTool(tool);
      return null;
    };

    const ui = renderWithCopilotKit({
      children: (
        <>
          <ToolComponent />
          <CoreCapture
            onCore={(c) => {
              coreRef = c;
            }}
          />
        </>
      ),
    });

    await waitFor(() => {
      expect(coreRef).not.toBeNull();
      const tool = coreRef!.tools.find((t) => t.name === "disabledTool");
      expect(tool).toBeDefined();
      expect(tool!.available).toBe(false);
    });

    ui.unmount();
  });

  it("registers tool with available: true on the core", async () => {
    let coreRef: CopilotKitCoreReact | null = null;

    const ToolComponent: React.FC = () => {
      const tool: ReactFrontendTool<{ msg: string }> = {
        name: "enabledTool",
        description: "An enabled tool",
        available: true,
        parameters: z.object({ msg: z.string() }),
        handler: async () => ({ result: "ok" }),
      };
      useFrontendTool(tool);
      return null;
    };

    const ui = renderWithCopilotKit({
      children: (
        <>
          <ToolComponent />
          <CoreCapture
            onCore={(c) => {
              coreRef = c;
            }}
          />
        </>
      ),
    });

    await waitFor(() => {
      expect(coreRef).not.toBeNull();
      const tool = coreRef!.tools.find((t) => t.name === "enabledTool");
      expect(tool).toBeDefined();
      expect(tool!.available).toBe(true);
    });

    ui.unmount();
  });

  it("re-registers tool when available toggles between true and false", async () => {
    let coreRef: CopilotKitCoreReact | null = null;

    const ToolWithToggle: React.FC = () => {
      const [isEnabled, setIsEnabled] = useState(true);

      const tool: ReactFrontendTool<{ data: string }> = {
        name: "toggleTool",
        description: "A toggleable tool",
        available: isEnabled,
        parameters: z.object({ data: z.string() }),
        handler: async () => ({ ok: true }),
      };
      useFrontendTool(tool, [isEnabled]);

      return (
        <button
          data-testid="toggle-btn"
          onClick={() => setIsEnabled((prev) => !prev)}
        >
          {isEnabled ? "Disable" : "Enable"}
        </button>
      );
    };

    const ui = renderWithCopilotKit({
      children: (
        <>
          <ToolWithToggle />
          <CoreCapture
            onCore={(c) => {
              coreRef = c;
            }}
          />
        </>
      ),
    });

    // Tool should be registered as enabled initially
    await waitFor(() => {
      expect(coreRef).not.toBeNull();
      const tool = coreRef!.tools.find((t) => t.name === "toggleTool");
      expect(tool).toBeDefined();
      expect(tool!.available).toBe(true);
    });

    // Toggle to disabled
    fireEvent.click(screen.getByTestId("toggle-btn"));

    // Tool should be re-registered as disabled
    await waitFor(() => {
      const tool = coreRef!.tools.find((t) => t.name === "toggleTool");
      expect(tool).toBeDefined();
      expect(tool!.available).toBe(false);
    });

    // Toggle back to enabled
    fireEvent.click(screen.getByTestId("toggle-btn"));

    await waitFor(() => {
      const tool = coreRef!.tools.find((t) => t.name === "toggleTool");
      expect(tool).toBeDefined();
      expect(tool!.available).toBe(true);
    });

    ui.unmount();
  });
});
