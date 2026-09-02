import React, { useEffect, useState } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { z } from "zod";
import { useFrontendTool } from "../use-frontend-tool";
import { useCopilotKit } from "../../providers/CopilotKitProvider";
import { ReactFrontendTool } from "../../types";
import { CopilotKitCoreReact } from "../../lib/react-core";
import { renderWithCopilotKit } from "../../__tests__/utils/test-helpers";

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

describe("useFrontendTool webmcp flag", () => {
  it("registers tool with webmcp: true on the core", async () => {
    let coreRef: CopilotKitCoreReact | null = null;

    const ToolComponent: React.FC = () => {
      const tool: ReactFrontendTool<{ msg: string }> = {
        name: "webmcpTool",
        description: "A WebMCP-exposed tool",
        webmcp: true,
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
      const tool = coreRef!.tools.find((t) => t.name === "webmcpTool");
      expect(tool).toBeDefined();
      expect(tool!.webmcp).toBe(true);
    });

    ui.unmount();
  });

  it("registers tool with webmcp annotations on the core", async () => {
    let coreRef: CopilotKitCoreReact | null = null;

    const ToolComponent: React.FC = () => {
      const tool: ReactFrontendTool<{ msg: string }> = {
        name: "annotatedTool",
        description: "A WebMCP-exposed tool with annotations",
        webmcp: { annotations: { readOnlyHint: true } },
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
      const tool = coreRef!.tools.find((t) => t.name === "annotatedTool");
      expect(tool).toBeDefined();
      expect(tool!.webmcp).toEqual({ annotations: { readOnlyHint: true } });
    });

    ui.unmount();
  });

  it("re-registers tool when the webmcp config changes", async () => {
    let coreRef: CopilotKitCoreReact | null = null;

    const ToolWithToggle: React.FC = () => {
      const [readOnly, setReadOnly] = useState(false);

      const tool: ReactFrontendTool<{ data: string }> = {
        name: "toggleWebmcpTool",
        description: "A tool with a toggleable WebMCP config",
        webmcp: { annotations: { readOnlyHint: readOnly } },
        parameters: z.object({ data: z.string() }),
        handler: async () => ({ ok: true }),
      };
      useFrontendTool(tool, [readOnly]);

      return (
        <button
          data-testid="toggle-btn"
          onClick={() => setReadOnly((prev) => !prev)}
        >
          {readOnly ? "Read-write" : "Read-only"}
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

    await waitFor(() => {
      expect(coreRef).not.toBeNull();
      const tool = coreRef!.tools.find((t) => t.name === "toggleWebmcpTool");
      expect(tool).toBeDefined();
      expect(tool!.webmcp).toEqual({ annotations: { readOnlyHint: false } });
    });

    fireEvent.click(screen.getByTestId("toggle-btn"));

    await waitFor(() => {
      const tool = coreRef!.tools.find((t) => t.name === "toggleWebmcpTool");
      expect(tool).toBeDefined();
      expect(tool!.webmcp).toEqual({ annotations: { readOnlyHint: true } });
    });

    ui.unmount();
  });
});
