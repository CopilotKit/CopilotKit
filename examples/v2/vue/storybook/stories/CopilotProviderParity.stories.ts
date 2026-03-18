import type { CopilotKitCoreVue } from "@copilotkitnext/vue";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { defineComponent, h, ref } from "vue";
import {
  AbstractAgent,
  type RunAgentParameters,
  type RunAgentResult,
  CopilotChat,
  CopilotKitProvider,
  useCopilotKit,
} from "@copilotkitnext/vue";

class LocalStoryAgent extends AbstractAgent {
  constructor(agentId = "default") {
    super({ agentId });
  }

  run() {
    throw new Error("LocalStoryAgent does not stream events in this story");
  }

  override clone(): LocalStoryAgent {
    const cloned = new LocalStoryAgent(this.agentId ?? "default");
    cloned.threadId = this.threadId;
    cloned.messages = JSON.parse(JSON.stringify(this.messages));
    return cloned;
  }

  override async runAgent(
    _parameters: RunAgentParameters = {},
  ): Promise<RunAgentResult> {
    return { newMessages: [] };
  }

  override async connectAgent(
    _parameters: RunAgentParameters = {},
  ): Promise<RunAgentResult> {
    return { newMessages: [] };
  }
}

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

const meta = {
  title: "Parity/CopilotKitProvider",
  parameters: {
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

export const SelfManagedAgents: Story = {
  render: () => ({
    components: { CopilotKitProvider, CopilotChat },
    setup() {
      const localAgent = new LocalStoryAgent("default");
      return { localAgent };
    },
    template: `
      <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden">
        <CopilotKitProvider :self-managed-agents="{ default: localAgent }">
          <CopilotChat :welcome-screen="false" />
        </CopilotKitProvider>
      </div>
    `,
  }),
};

export const ProviderOnError: Story = {
  render: () => ({
    components: { CopilotKitProvider, CopilotChat },
    setup() {
      const providerErrors = ref<string[]>([]);
      const providerOnError = (event: {
        error: Error;
        code: string;
        context: Record<string, any>;
      }) => {
        providerErrors.value.push(`${event.code}: ${event.error.message}`);
      };

      const ErrorEmitter = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          const emitProviderError = async () => {
            await (copilotkit.value as unknown as CopilotKitCoreTestAccess).notifySubscribers(
              (subscriber) =>
                subscriber.onError?.({
                  copilotkit: copilotkit.value,
                  error: new Error("storybook provider error"),
                  code: "RUNTIME_INFO_FETCH_FAILED",
                  context: { source: "storybook" },
                }),
              "storybook provider parity error",
            );
          };

          return () =>
            h(
              "button",
              {
                type: "button",
                style:
                  "padding: 8px 12px; border-radius: 8px; border: 1px solid #d1d5db; background: #111827; color: white;",
                onClick: () => void emitProviderError(),
              },
              "Emit Provider Error",
            );
        },
      });

      return { providerErrors, providerOnError, ErrorEmitter };
    },
    template: `
      <div style="display: grid; grid-template-columns: 300px 1fr; gap: 12px; height: 100vh; padding: 12px;">
        <div style="border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; overflow: auto;">
          <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">Provider onError Log</h3>
          <ErrorEmitter />
          <ul style="margin-top: 12px; padding-left: 16px;">
            <li v-for="entry in providerErrors" :key="entry">{{ entry }}</li>
          </ul>
        </div>
        <CopilotKitProvider runtime-url="/api/copilotkit" :on-error="providerOnError">
          <CopilotChat :welcome-screen="false" />
        </CopilotKitProvider>
      </div>
    `,
  }),
};

export const ChatOnErrorScoped: Story = {
  render: () => ({
    components: { CopilotKitProvider, CopilotChat },
    setup() {
      const chatErrors = ref<string[]>([]);

      const chatOnError = (event: {
        error: Error;
        code: string;
      }) => {
        chatErrors.value.push(`${event.code}: ${event.error.message}`);
      };

      const ErrorEmitter = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();

          const emitErrorFor = async (agentId?: string) => {
            await (copilotkit.value as unknown as CopilotKitCoreTestAccess).notifySubscribers(
              (subscriber) =>
                subscriber.onError?.({
                  copilotkit: copilotkit.value,
                  error: new Error(agentId ? `error for ${agentId}` : "global error"),
                  code: "RUNTIME_INFO_FETCH_FAILED",
                  context: agentId ? { source: "storybook", agentId } : { source: "storybook" },
                }),
              "storybook chat parity error",
            );
          };

          return () =>
            h("div", { style: "display: flex; gap: 8px; flex-wrap: wrap;" }, [
              h(
                "button",
                {
                  type: "button",
                  style:
                    "padding: 8px 12px; border-radius: 8px; border: 1px solid #d1d5db; background: #111827; color: white;",
                  onClick: () => void emitErrorFor("default"),
                },
                "Emit Error (default)",
              ),
              h(
                "button",
                {
                  type: "button",
                  style:
                    "padding: 8px 12px; border-radius: 8px; border: 1px solid #d1d5db; background: white; color: #111827;",
                  onClick: () => void emitErrorFor("other-agent"),
                },
                "Emit Error (other-agent)",
              ),
            ]);
        },
      });

      return { chatErrors, chatOnError, ErrorEmitter };
    },
    template: `
      <div style="display: grid; grid-template-columns: 320px 1fr; gap: 12px; height: 100vh; padding: 12px;">
        <div style="border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; overflow: auto;">
          <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">Chat onError Log (agent-scoped)</h3>
          <ErrorEmitter />
          <ul style="margin-top: 12px; padding-left: 16px;">
            <li v-if="chatErrors.length === 0">No chat errors yet</li>
            <li v-for="entry in chatErrors" :key="entry">{{ entry }}</li>
          </ul>
        </div>
        <CopilotKitProvider runtime-url="/api/copilotkit">
          <CopilotChat :welcome-screen="false" :on-error="chatOnError" />
        </CopilotKitProvider>
      </div>
    `,
  }),
};
