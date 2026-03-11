import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, type VNode } from "vue";
import CopilotKitProvider from "../../providers/CopilotKitProvider.vue";
import { useCopilotKit } from "../../providers/useCopilotKit";
import type { CopilotKitCoreVue } from "../../lib/vue-core";

export function mountWithProvider(
  content: () => VNode,
  props: Record<string, unknown> = {},
): { wrapper: VueWrapper; getCore: () => CopilotKitCoreVue } {
  let core: CopilotKitCoreVue | undefined;

  const Probe = defineComponent({
    setup() {
      const { copilotkit } = useCopilotKit();
      core = copilotkit.value;
      return () => null;
    },
  });

  const wrapper = mount(CopilotKitProvider, {
    props: {
      runtimeUrl: "/api/copilotkit",
      ...props,
    },
    slots: {
      default: () => h("div", [content(), h(Probe)]),
    },
  });

  return {
    wrapper,
    getCore: () => {
      if (!core) {
        throw new Error("CopilotKit core not available from provider mount");
      }
      return core;
    },
  };
}
