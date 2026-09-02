import { defineComponent, ref, watch } from "vue";
import { screen, fireEvent, waitFor } from "@testing-library/vue";
import { z } from "zod";
import { describe, it, expect } from "vitest";
import { useFrontendTool } from "../use-frontend-tool";
import { useCopilotKit } from "../../providers/useCopilotKit";
import type { VueFrontendTool } from "../../types";
import type { CopilotKitCoreVue } from "../../lib/vue-core";
import { renderWithCopilotKit } from "../../__tests__/utils/test-helpers";

/**
 * Component that captures the copilotkit core ref for test assertions.
 */
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

describe("useFrontendTool webmcp flag", () => {
  it("registers tool with webmcp: true on the core", async () => {
    let coreRef: CopilotKitCoreVue | null = null;

    const ToolComponent = defineComponent({
      setup() {
        const tool: VueFrontendTool<{ msg: string }> = {
          name: "webmcpTool",
          description: "A WebMCP-exposed tool",
          webmcp: true,
          parameters: z.object({ msg: z.string() }),
          handler: async () => ({ result: "ok" }),
        };
        useFrontendTool(tool);
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

    await waitFor(() => {
      expect(coreRef).not.toBeNull();
      const tool = coreRef!.tools.find((entry) => entry.name === "webmcpTool");
      expect(tool).toBeDefined();
      expect(tool!.webmcp).toBe(true);
    });

    ui.unmount();
  });

  it("registers tool with webmcp annotations on the core", async () => {
    let coreRef: CopilotKitCoreVue | null = null;

    const ToolComponent = defineComponent({
      setup() {
        const tool: VueFrontendTool<{ msg: string }> = {
          name: "annotatedTool",
          description: "A WebMCP-exposed tool with annotations",
          webmcp: { annotations: { readOnlyHint: true } },
          parameters: z.object({ msg: z.string() }),
          handler: async () => ({ result: "ok" }),
        };
        useFrontendTool(tool);
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

    await waitFor(() => {
      expect(coreRef).not.toBeNull();
      const tool = coreRef!.tools.find(
        (entry) => entry.name === "annotatedTool",
      );
      expect(tool).toBeDefined();
      expect(tool!.webmcp).toEqual({ annotations: { readOnlyHint: true } });
    });

    ui.unmount();
  });

  it("re-registers tool when the webmcp config changes", async () => {
    let coreRef: CopilotKitCoreVue | null = null;

    const ToolWithToggle = defineComponent({
      setup() {
        const readOnly = ref(false);

        const tool: VueFrontendTool<{ data: string }> = {
          name: "toggleWebmcpTool",
          description: "A tool with a toggleable WebMCP config",
          get webmcp() {
            return { annotations: { readOnlyHint: readOnly.value } };
          },
          parameters: z.object({ data: z.string() }),
          handler: async () => ({ ok: true }),
        };
        useFrontendTool(tool, [readOnly]);

        return {
          readOnly,
          toggle: () => {
            readOnly.value = !readOnly.value;
          },
        };
      },
      template: `
        <button data-testid="toggle-btn" @click="toggle">
          {{ readOnly ? "Read-write" : "Read-only" }}
        </button>
      `,
    });

    const Host = defineComponent({
      components: { ToolWithToggle, CoreCapture },
      setup() {
        return {
          setCore: (core: CopilotKitCoreVue) => {
            coreRef = core;
          },
        };
      },
      template: `
        <div>
          <ToolWithToggle />
          <CoreCapture :on-core="setCore" />
        </div>
      `,
    });

    const ui = renderWithCopilotKit({
      children: Host,
    });

    await waitFor(() => {
      expect(coreRef).not.toBeNull();
      const tool = coreRef!.tools.find(
        (entry) => entry.name === "toggleWebmcpTool",
      );
      expect(tool).toBeDefined();
      expect(tool!.webmcp).toEqual({ annotations: { readOnlyHint: false } });
    });

    await fireEvent.click(screen.getByTestId("toggle-btn"));

    await waitFor(() => {
      const tool = coreRef!.tools.find(
        (entry) => entry.name === "toggleWebmcpTool",
      );
      expect(tool).toBeDefined();
      expect(tool!.webmcp).toEqual({ annotations: { readOnlyHint: true } });
    });

    ui.unmount();
  });
});
