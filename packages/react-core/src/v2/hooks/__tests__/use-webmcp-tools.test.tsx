import React, { useEffect } from "react";
import { act, waitFor } from "@testing-library/react";
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

function renderImportedTools(ToolComponent: React.FC) {
  let coreRef: CopilotKitCoreReact | null = null;
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
  return {
    ui,
    getCore: () => coreRef,
  };
}

describe("useWebmcpTools", () => {
  it("imports page tools onto the core and cleans them up on unmount", async () => {
    stubPageTools([createPageTool("addTodo"), createPageTool("listTodos")]);

    const ToolComponent: React.FC = () => {
      useWebmcpTools();
      return null;
    };
    const { ui, getCore } = renderImportedTools(ToolComponent);

    await waitFor(() => {
      expect(getCore()).not.toBeNull();
      expect(
        getCore()!
          .tools.map((tool) => tool.name)
          .sort(),
      ).toEqual(["addTodo", "listTodos"]);
    });

    ui.unmount();

    await waitFor(() => {
      expect(
        getCore()!.tools.filter((tool) => tool.name === "addTodo"),
      ).toEqual([]);
    });
  });

  it("passes agentId and allow to the imported tools", async () => {
    stubPageTools([
      createPageTool("searchOrders"),
      createPageTool("deleteOrder"),
    ]);

    const ToolComponent: React.FC = () => {
      useWebmcpTools({
        agentId: "support",
        allow: ["searchOrders"],
      });
      return null;
    };
    const { getCore } = renderImportedTools(ToolComponent);

    await waitFor(() => {
      const tool = getCore()!.tools.find(
        (entry) => entry.name === "searchOrders",
      );
      expect(tool?.agentId).toBe("support");
      expect(
        getCore()!.tools.find((entry) => entry.name === "deleteOrder"),
      ).toBeUndefined();
    });
  });

  it("runs executeTool when the imported handler is called", async () => {
    const pageTool = createPageTool("addTodo");
    const { executeTool } = stubPageTools([pageTool]);

    const ToolComponent: React.FC = () => {
      useWebmcpTools();
      return null;
    };
    const { getCore } = renderImportedTools(ToolComponent);

    await waitFor(() => {
      expect(getCore()?.getTool({ toolName: "addTodo" })?.handler).toBeTypeOf(
        "function",
      );
    });

    const result = await getCore()!.getTool({ toolName: "addTodo" })!.handler!(
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

  it("restarts when the filter callback changes", async () => {
    stubPageTools([createPageTool("orders"), createPageTool("searchOrders")]);
    type ToolFilter = (tool: WebMCPRegisteredTool) => boolean;
    let updateFilter: ((next: ToolFilter) => void) | undefined;

    const ToolComponent: React.FC = () => {
      const [filter, setFilter] = React.useState<{ fn: ToolFilter }>({
        fn: (tool) => tool.name === "orders",
      });
      updateFilter = (next) => {
        setFilter({ fn: next });
      };
      useWebmcpTools({ filter: filter.fn });
      return null;
    };
    const { getCore } = renderImportedTools(ToolComponent);

    await waitFor(() => {
      expect(getCore()).not.toBeNull();
      expect(getCore()!.tools.map((tool) => tool.name)).toEqual(["orders"]);
    });

    act(() => {
      updateFilter?.((tool) => /orders/i.test(tool.name));
    });

    await waitFor(() => {
      expect(
        getCore()!
          .tools.map((tool) => tool.name)
          .sort(),
      ).toEqual(["orders", "searchOrders"]);
    });
  });
});
