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

describe("useFrontendTool available flag", () => {
  it("registers tool with available: false on the core", async () => {
    let coreRef: CopilotKitCoreVue | null = null;

    const ToolComponent = defineComponent({
      setup() {
        const tool: VueFrontendTool<{ msg: string }> = {
          name: "disabledTool",
          description: "A disabled tool",
          available: false,
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
        (entry) => entry.name === "disabledTool",
      );
      expect(tool).toBeDefined();
      expect(tool!.available).toBe(false);
    });

    ui.unmount();
  });

  it("registers tool with available: true on the core", async () => {
    let coreRef: CopilotKitCoreVue | null = null;

    const ToolComponent = defineComponent({
      setup() {
        const tool: VueFrontendTool<{ msg: string }> = {
          name: "enabledTool",
          description: "An enabled tool",
          available: true,
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
      const tool = coreRef!.tools.find((entry) => entry.name === "enabledTool");
      expect(tool).toBeDefined();
      expect(tool!.available).toBe(true);
    });

    ui.unmount();
  });

  it("re-registers tool when available toggles between true and false", async () => {
    let coreRef: CopilotKitCoreVue | null = null;

    const ToolWithToggle = defineComponent({
      setup() {
        const isEnabled = ref(true);

        const tool: VueFrontendTool<{ data: string }> = {
          name: "toggleTool",
          description: "A toggleable tool",
          get available() {
            return isEnabled.value;
          },
          parameters: z.object({ data: z.string() }),
          handler: async () => ({ ok: true }),
        };
        useFrontendTool(tool, [isEnabled]);

        return {
          isEnabled,
          toggle: () => {
            isEnabled.value = !isEnabled.value;
          },
        };
      },
      template: `
        <button data-testid="toggle-btn" @click="toggle">
          {{ isEnabled ? "Disable" : "Enable" }}
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

    // Tool should be registered as enabled initially
    await waitFor(() => {
      expect(coreRef).not.toBeNull();
      const tool = coreRef!.tools.find((entry) => entry.name === "toggleTool");
      expect(tool).toBeDefined();
      expect(tool!.available).toBe(true);
    });

    // Toggle to disabled
    await fireEvent.click(screen.getByTestId("toggle-btn"));

    // Tool should be re-registered as disabled
    await waitFor(() => {
      const tool = coreRef!.tools.find((entry) => entry.name === "toggleTool");
      expect(tool).toBeDefined();
      expect(tool!.available).toBe(false);
    });

    // Toggle back to enabled
    await fireEvent.click(screen.getByTestId("toggle-btn"));

    await waitFor(() => {
      const tool = coreRef!.tools.find((entry) => entry.name === "toggleTool");
      expect(tool).toBeDefined();
      expect(tool!.available).toBe(true);
    });

    ui.unmount();
  });
});
