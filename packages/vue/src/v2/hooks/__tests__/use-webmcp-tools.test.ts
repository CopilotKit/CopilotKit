import { defineComponent, reactive, watch } from "vue";
import { waitFor } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWebmcpTools } from "../use-webmcp-tools";
import { useCopilotKit } from "../../providers/useCopilotKit";
import type { CopilotKitCoreVue } from "../../lib/vue-core";
import { renderWithCopilotKit } from "../../__tests__/utils/test-helpers";
import type { WebMCPRegisteredTool } from "@copilotkit/core";

const CoreCapture = defineComponent({
  props: {
    onCore: {
      type: Function as () => (core: CopilotKitCoreVue) => void,
      required: true,
    },
  },
  setup(props) {
    const { copilotkit } = useCopilotKit();
    watch(
      copilotkit,
      (core) => {
        if (core) {
          props.onCore(core);
        }
      },
      { immediate: true },
    );
    return {};
  },
  template: `<div />`,
});

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

function renderImportedTools(setupFn: () => void) {
  let coreRef: CopilotKitCoreVue | null = null;
  const ToolComponent = defineComponent({
    setup() {
      setupFn();
      return {};
    },
    template: `<div />`,
  });
  const Host = defineComponent({
    components: { ToolComponent, CoreCapture },
    setup() {
      return {
        setCore: (core: CopilotKitCoreVue) => {
          coreRef = core;
        },
      };
    },
    template: `
      <div>
        <ToolComponent />
        <CoreCapture :on-core="setCore" />
      </div>
    `,
  });
  const ui = renderWithCopilotKit({
    children: Host,
  });
  return {
    ui,
    getCore: () => coreRef,
  };
}

describe("useWebmcpTools", () => {
  it("imports page tools onto the core and cleans them up on unmount", async () => {
    stubPageTools([createPageTool("addTodo"), createPageTool("listTodos")]);

    const { ui, getCore } = renderImportedTools(() => {
      useWebmcpTools();
    });

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

    const { getCore } = renderImportedTools(() => {
      useWebmcpTools({
        agentId: "support",
        allow: ["searchOrders"],
      });
    });

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

    const { getCore } = renderImportedTools(() => {
      useWebmcpTools();
    });

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

  it("restarts when name changes from a string to a matching RegExp", async () => {
    stubPageTools([createPageTool("orders"), createPageTool("searchOrders")]);
    const options = reactive<{ name: string | RegExp }>({
      name: "/orders/i",
    });

    const { getCore } = renderImportedTools(() => {
      useWebmcpTools(options);
    });

    await waitFor(() => {
      expect(getCore()).not.toBeNull();
      expect(getCore()!.tools.map((tool) => tool.name)).toEqual([]);
    });

    options.name = /orders/i;

    await waitFor(() => {
      expect(
        getCore()!
          .tools.map((tool) => tool.name)
          .sort(),
      ).toEqual(["orders", "searchOrders"]);
    });
  });
});
