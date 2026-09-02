import { defineComponent, ref, watch } from "vue";
import { screen, fireEvent, waitFor } from "@testing-library/vue";
import { describe, it, expect } from "vitest";
import { useFrontendTool } from "../use-frontend-tool";
import { useCopilotKit } from "../../v2/providers/useCopilotKit";
import type { CopilotKitCoreVue } from "../../v2/lib/vue-core";
import { renderWithCopilotKit } from "../../v2/__tests__/utils/test-helpers";

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

describe("useFrontendTool v1 webmcp pass-through", () => {
  it("re-registers tool when a reactive webmcp getter changes", async () => {
    let coreRef: CopilotKitCoreVue | null = null;

    const ToolComponent = defineComponent({
      setup() {
        const readOnly = ref(false);

        useFrontendTool(
          {
            name: "v1WebmcpTool",
            description: "A v1 WebMCP-exposed tool",
            handler: async () => ({ ok: true }),
            // Expose webmcp as a getter over reactive state: the registration
            // must re-read it when it changes, not capture the initial value.
            get webmcp() {
              return { annotations: { readOnlyHint: readOnly.value } };
            },
          },
          [readOnly],
        );

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
        (entry) => entry.name === "v1WebmcpTool",
      );
      expect(tool).toBeDefined();
      expect(tool!.webmcp).toEqual({ annotations: { readOnlyHint: false } });
    });

    await fireEvent.click(screen.getByTestId("toggle-btn"));

    await waitFor(() => {
      const tool = coreRef!.tools.find(
        (entry) => entry.name === "v1WebmcpTool",
      );
      expect(tool).toBeDefined();
      expect(tool!.webmcp).toEqual({ annotations: { readOnlyHint: true } });
    });

    ui.unmount();
  });
});
