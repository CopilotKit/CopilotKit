import React, { useEffect } from "react";
import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWebmcpTools } from "../use-webmcp-tools";
import { useCopilotKit } from "../../providers/CopilotKitProvider";
import type { CopilotKitCoreReact } from "../../lib/react-core";
import { renderWithCopilotKit } from "../../__tests__/utils/test-helpers";
import type { WebMCPRegisteredTool } from "@copilotkit/core";

const CoreCapture: React.FC<{
  onCore: (core: CopilotKitCoreReact) => void;
}> = ({ onCore }) => {
  const { copilotkit } = useCopilotKit();
  useEffect(() => {
    onCore(copilotkit);
  }, [copilotkit, onCore]);
  return null;
};

function createPageTool(name: string): WebMCPRegisteredTool {
  return {
    name,
    description: `${name} description`,
    inputSchema: { type: "object", properties: {} },
  };
}

type DocumentWithModelContext = Document & {
  modelContext?: {
    registerTool: ReturnType<typeof vi.fn>;
    getTools: ReturnType<typeof vi.fn>;
    executeTool: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };
};

function stubPageTools(pageTools: WebMCPRegisteredTool[]) {
  const executeTool = vi.fn(async (tool: WebMCPRegisteredTool, input) => ({
    ran: tool.name,
    input,
  }));
  const doc = document as DocumentWithModelContext;
  doc.modelContext = {
    registerTool: vi.fn(async () => undefined),
    getTools: vi.fn(async () => pageTools.slice()),
    executeTool,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return { executeTool };
}

afterEach(() => {
  delete (document as DocumentWithModelContext).modelContext;
  vi.restoreAllMocks();
});

describe("useWebmcpTools", () => {
  it("imports page tools onto the core and cleans them up on unmount", async () => {
    stubPageTools([createPageTool("addTodo"), createPageTool("listTodos")]);
    let coreRef: CopilotKitCoreReact | null = null;

    const ToolComponent: React.FC = () => {
      useWebmcpTools();
      return null;
    };

    const ui = renderWithCopilotKit({
      children: (
        <>
          <ToolComponent />
          <CoreCapture
            onCore={(core) => {
              coreRef = core;
            }}
          />
        </>
      ),
    });

    await waitFor(() => {
      expect(coreRef).not.toBeNull();
      expect(coreRef!.tools.map((tool) => tool.name).sort()).toEqual([
        "addTodo",
        "listTodos",
      ]);
    });

    ui.unmount();

    await waitFor(() => {
      expect(coreRef!.tools.filter((tool) => tool.name === "addTodo")).toEqual(
        [],
      );
    });
  });

  it("passes agentId and allow to the imported tools", async () => {
    stubPageTools([
      createPageTool("searchOrders"),
      createPageTool("deleteOrder"),
    ]);
    let coreRef: CopilotKitCoreReact | null = null;

    const ToolComponent: React.FC = () => {
      useWebmcpTools({
        agentId: "support",
        allow: ["searchOrders"],
      });
      return null;
    };

    renderWithCopilotKit({
      children: (
        <>
          <ToolComponent />
          <CoreCapture
            onCore={(core) => {
              coreRef = core;
            }}
          />
        </>
      ),
    });

    await waitFor(() => {
      const tool = coreRef!.tools.find(
        (entry) => entry.name === "searchOrders",
      );
      expect(tool?.agentId).toBe("support");
      expect(
        coreRef!.tools.find((entry) => entry.name === "deleteOrder"),
      ).toBeUndefined();
    });
  });

  it("runs executeTool when the imported handler is called", async () => {
    const pageTool = createPageTool("addTodo");
    const { executeTool } = stubPageTools([pageTool]);
    let coreRef: CopilotKitCoreReact | null = null;

    const ToolComponent: React.FC = () => {
      useWebmcpTools();
      return null;
    };

    renderWithCopilotKit({
      children: (
        <>
          <ToolComponent />
          <CoreCapture
            onCore={(core) => {
              coreRef = core;
            }}
          />
        </>
      ),
    });

    await waitFor(() => {
      expect(coreRef?.getTool({ toolName: "addTodo" })?.handler).toBeTypeOf(
        "function",
      );
    });

    const result = await coreRef!.getTool({ toolName: "addTodo" })!.handler!(
      { text: "milk" },
      {
        toolCall: {
          id: "call-1",
          type: "function",
          function: { name: "addTodo", arguments: '{"text":"milk"}' },
        },
      },
    );

    expect(executeTool).toHaveBeenCalledWith(
      pageTool,
      { text: "milk" },
      expect.objectContaining({}),
    );
    expect(result).toEqual({ ran: "addTodo", input: { text: "milk" } });
  });
});
