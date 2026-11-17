import { mount } from "@vue/test-utils";
import type { VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import type { VNode } from "vue";
import type { AbstractAgent } from "@ag-ui/client";
import CopilotKitProvider from "../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../providers/CopilotChatConfigurationProvider.vue";
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

export function renderWithCopilotKit(
  content: () => VNode,
  options: {
    agent?: AbstractAgent;
    agentId?: string;
    threadId?: string;
    providerProps?: Record<string, unknown>;
    configProps?: Record<string, unknown>;
    agents?: Record<string, AbstractAgent>;
  } = {},
): { wrapper: VueWrapper; getCore: () => CopilotKitCoreVue } {
  const providerProps = options.providerProps ?? {};
  const resolvedAgentId = options.agentId ?? "default";
  const resolvedThreadId = options.threadId ?? "test-thread";
  const resolvedAgents =
    options.agents ??
    (options.agent ? { [resolvedAgentId]: options.agent } : undefined);
  // Default `hasExplicitThreadId: false` so the implicit wrapping does not
  // force callers into "caller picked this thread" mode. Tests that want
  // explicit-thread semantics (e.g. `/connect` gating, welcome suppression)
  // override `configProps` to set `hasExplicitThreadId: true`.
  const configProps = options.configProps ?? {
    threadId: resolvedThreadId,
    agentId: resolvedAgentId,
    hasExplicitThreadId: false,
  };

  return mountWithProvider(
    () =>
      h(CopilotChatConfigurationProvider, configProps, {
        default: () => content(),
      }),
    {
      agents__unsafe_dev_only: resolvedAgents,
      ...providerProps,
    },
  );
}
