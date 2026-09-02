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
      // No deps: the re-registration must come from the webmcp dependency
      // alone, not from an explicit dependency on the same state.
      useFrontendTool(tool);

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

  it("registers and cleans up agent-scoped webmcp tools on the core", async () => {
    let coreRef: CopilotKitCoreReact | null = null;

    const ToolComponent: React.FC = () => {
      useFrontendTool({
        name: "scopedTool",
        description: "A WebMCP tool scoped to alpha",
        agentId: "alpha",
        webmcp: { annotations: { readOnlyHint: true } },
        handler: async () => ({ ok: true }),
      });
      useFrontendTool({
        name: "scopedTool",
        description: "A WebMCP tool scoped to beta",
        agentId: "beta",
        webmcp: true,
        handler: async () => ({ ok: true }),
      });
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
      const alphaTool = coreRef!.tools.find(
        (t) => t.name === "scopedTool" && t.agentId === "alpha",
      );
      expect(alphaTool).toBeDefined();
      expect(alphaTool!.webmcp).toEqual({ annotations: { readOnlyHint: true } });
      const betaTool = coreRef!.tools.find(
        (t) => t.name === "scopedTool" && t.agentId === "beta",
      );
      expect(betaTool).toBeDefined();
      expect(betaTool!.webmcp).toBe(true);
    });

    ui.unmount();

    await waitFor(() => {
      expect(
        coreRef!.tools.filter((t) => t.name === "scopedTool").length,
      ).toBe(0);
    });
  });
});
