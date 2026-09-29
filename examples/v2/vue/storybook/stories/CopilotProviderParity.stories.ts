import type { CopilotKitCoreVue } from "@copilotkit/vue";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { defineComponent, h, ref } from "vue";
import {
  CopilotChat,
  CopilotKitProvider,
  useCopilotKit,
} from "@copilotkit/vue";
import { StoryAgent } from "./support/story-agent";

type CopilotKitCoreTestAccess = {
  notifySubscribers: (
    handler: (subscriber: {
      onError?: (event: {
        copilotkit: CopilotKitCoreVue;
        error: Error;
        code: string;
        context: Record<string, any>;
      }) => void | Promise<void>;
    }) => void | Promise<void>,
    errorMessage: string,
  ) => Promise<void>;
};

/** Emits a synthetic core error, the way a failed runtime call would surface. */
const ErrorEmitter = defineComponent({
  name: "ErrorEmitter",
  props: {
    agentIds: {
      type: Array as () => (string | undefined)[],
      default: () => [undefined],
    },
  },
  setup(props) {
    const { copilotkit } = useCopilotKit();
    const emitErrorFor = async (agentId?: string) => {
      await (
        copilotkit.value as unknown as CopilotKitCoreTestAccess
      ).notifySubscribers(
        (subscriber) =>
          subscriber.onError?.({
            copilotkit: copilotkit.value,
            error: new Error(
              agentId ? `error for ${agentId}` : "storybook provider error",
            ),
            code: "RUNTIME_INFO_FETCH_FAILED",
            context: agentId
              ? { source: "storybook", agentId }
              : { source: "storybook" },
          }),
        "storybook parity error",
      );
    };

    return () =>
      h(
        "div",
        { class: "story-row" },
        props.agentIds.map((agentId, index) =>
          h(
            "button",
            {
              type: "button",
              class: [
                "story-button",
                index === 0 ? "story-button--primary" : "",
              ],
              onClick: () => void emitErrorFor(agentId),
            },
            agentId ? `Emit error (${agentId})` : "Emit provider error",
          ),
        ),
      );
  },
});

const meta = {
  title: "Parity/CopilotKitProvider",
  parameters: {
    layout: "fullscreen",
    // These stories render their own provider.
    copilotkit: false,
    docs: {
      description: {
        component:
          "Parity bridge stories for provider features that currently have no dedicated React Storybook counterpart.",
      },
    },
  },
} satisfies Meta<{}>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Agents passed through `selfManagedAgents` are used without a runtime. */
export const SelfManagedAgents: Story = {
  render: () => ({
    components: { CopilotKitProvider, CopilotChat },
    setup() {
      return { agents: { default: new StoryAgent() } };
    },
    template: `
      <div class="story-full">
        <CopilotKitProvider :self-managed-agents="agents" :enable-inspector="false">
          <CopilotChat />
        </CopilotKitProvider>
      </div>
    `,
  }),
};

export const ProviderOnError: Story = {
  render: () => ({
    components: { CopilotKitProvider, CopilotChat, ErrorEmitter },
    setup() {
      const providerErrors = ref<string[]>([]);
      const providerOnError = (event: { error: Error; code: string }) => {
        providerErrors.value.push(`${event.code}: ${event.error.message}`);
      };
      return {
        agents: { default: new StoryAgent() },
        providerErrors,
        providerOnError,
      };
    },
    template: `
      <CopilotKitProvider
        :agents__unsafe_dev_only="agents"
        :enable-inspector="false"
        :on-error="providerOnError"
      >
        <div style="display: grid; grid-template-columns: 300px 1fr; gap: 12px; height: 100vh; box-sizing: border-box; padding: 12px">
          <section class="story-panel" style="overflow: auto">
            <h3 class="story-panel__title">Provider onError log</h3>
            <ErrorEmitter />
            <ul class="story-log">
              <li v-if="providerErrors.length === 0">No provider errors yet</li>
              <li v-for="(entry, index) in providerErrors" :key="index">{{ entry }}</li>
            </ul>
          </section>
          <CopilotChat :welcome-screen="false" />
        </div>
      </CopilotKitProvider>
    `,
  }),
};

export const ChatOnErrorScoped: Story = {
  render: () => ({
    components: { CopilotKitProvider, CopilotChat, ErrorEmitter },
    setup() {
      const chatErrors = ref<string[]>([]);
      const chatOnError = (event: { error: Error; code: string }) => {
        chatErrors.value.push(`${event.code}: ${event.error.message}`);
      };
      return {
        agents: { default: new StoryAgent() },
        chatErrors,
        chatOnError,
      };
    },
    template: `
      <CopilotKitProvider :agents__unsafe_dev_only="agents" :enable-inspector="false">
        <div style="display: grid; grid-template-columns: 320px 1fr; gap: 12px; height: 100vh; box-sizing: border-box; padding: 12px">
          <section class="story-panel" style="overflow: auto">
            <h3 class="story-panel__title">Chat onError log (agent-scoped)</h3>
            <ErrorEmitter :agent-ids="['default', 'other-agent']" />
            <ul class="story-log">
              <li v-if="chatErrors.length === 0">No chat errors yet</li>
              <li v-for="(entry, index) in chatErrors" :key="index">{{ entry }}</li>
            </ul>
          </section>
          <CopilotChat :welcome-screen="false" :on-error="chatOnError" />
        </div>
      </CopilotKitProvider>
    `,
  }),
};
