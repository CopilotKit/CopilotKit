<script setup lang="ts">
import { AbstractAgent, type BaseEvent, type RunAgentParameters, type RunAgentResult } from "@ag-ui/client";
import { Observable } from "rxjs";
import { computed, defineComponent, h, ref } from "vue";
import { z } from "zod";
import {
  CopilotChat,
  CopilotKitProvider,
  type InterruptRenderProps,
  useCopilotKit,
  useAgentContext,
  useConfigureSuggestions,
  useFrontendTool,
  type ToolsMenuItem,
} from "@copilotkitnext/vue";

const selectedThreadId = ref<"thread---a" | "thread---b" | "thread---c">("thread---a");
const providerErrorLog = ref<string[]>([]);
const chatErrorLog = ref<string[]>([]);
const interruptResolveLog = ref<string[]>([]);

type CopilotKitCoreTestAccess = {
  notifySubscribers: (
    handler: (subscriber: {
      onError?: (event: {
        error: Error;
        code: string;
        context: Record<string, any>;
      }) => void | Promise<void>;
    }) => void | Promise<void>,
    errorMessage: string,
  ) => Promise<void>;
};

const threadOptions: Array<{ id: typeof selectedThreadId.value; label: string }> = [
  { id: "thread---a", label: "Thread A" },
  { id: "thread---b", label: "Thread B" },
  { id: "thread---c", label: "Thread C" },
];

const toolsMenu: (ToolsMenuItem | "-")[] = [
  {
    label: "Say hi to CopilotKit",
    action: () => {
      if (typeof window === "undefined") {
        return;
      }
      const textarea = window.document.querySelector<HTMLTextAreaElement>("textarea[placeholder='Type a message...']");
      if (!textarea) {
        return;
      }
      const greeting = "Hello Copilot! 👋 Could you help me with something?";
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      nativeInputValueSetter?.call(textarea, greeting);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.focus();
    },
  },
  "-",
  {
    label: "Open CopilotKit Docs",
    action: () => {
      if (typeof window !== "undefined") {
        window.open("https://docs.copilotkit.ai", "_blank", "noopener,noreferrer");
      }
    },
  },
];

class LocalDemoAgent extends AbstractAgent {
  constructor(agentId = "default") {
    super({ agentId });
  }

  run(): Observable<BaseEvent> {
    return new Observable((subscriber) => subscriber.complete());
  }

  override clone(): LocalDemoAgent {
    const cloned = new LocalDemoAgent(this.agentId ?? "default");
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

const selfManagedDemoAgent = new LocalDemoAgent("default");

function handleProviderError(event: { code: string; error: Error }) {
  providerErrorLog.value.unshift(`${event.code}: ${event.error.message}`);
  if (providerErrorLog.value.length > 6) {
    providerErrorLog.value.length = 6;
  }
}

function handleChatError(event: { code: string; error: Error }) {
  chatErrorLog.value.unshift(`${event.code}: ${event.error.message}`);
  if (chatErrorLog.value.length > 6) {
    chatErrorLog.value.length = 6;
  }
}

const EmitSyntheticErrors = defineComponent({
  name: "EmitSyntheticErrors",
  setup() {
    const { copilotkit } = useCopilotKit();
    const emitErrorFor = async (agentId?: string) => {
      await (copilotkit.value as unknown as CopilotKitCoreTestAccess).notifySubscribers(
        (subscriber) =>
          subscriber.onError?.({
            error: new Error(agentId ? `synthetic error for ${agentId}` : "synthetic global error"),
            code: "RUNTIME_INFO_FETCH_FAILED",
            context: agentId ? { source: "vue-demo", agentId } : { source: "vue-demo" },
          }),
        "vue demo parity error",
      );
    };

    return () =>
      h("div", { style: "display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;" }, [
        h(
          "button",
          {
            type: "button",
            style:
              "padding: 6px 10px; border-radius: 8px; border: 1px solid #d1d5db; background: #111827; color: #fff; cursor: pointer;",
            onClick: () => void emitErrorFor("default"),
          },
          "Emit error (default)",
        ),
        h(
          "button",
          {
            type: "button",
            style:
              "padding: 6px 10px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; color: #111827; cursor: pointer;",
            onClick: () => void emitErrorFor("other-agent"),
          },
          "Emit error (other-agent)",
        ),
      ]);
  },
});

const TriggerSyntheticInterrupt = defineComponent({
  name: "TriggerSyntheticInterrupt",
  setup() {
    const { copilotkit } = useCopilotKit();
    const triggerInterrupt = () => {
      const state: InterruptRenderProps<{ prompt: string }, { label: string }> = {
        event: {
          name: "on_interrupt",
          value: {
            prompt: "Approve applying this interrupt?",
          },
        },
        result: { label: "Awaiting decision" },
        resolve: (response: unknown) => {
          interruptResolveLog.value.unshift(JSON.stringify(response));
          if (interruptResolveLog.value.length > 4) {
            interruptResolveLog.value.length = 4;
          }
          copilotkit.value.setInterruptState(null);
        },
      };
      copilotkit.value.setInterruptState(state);
    };

    return () =>
      h(
        "button",
        {
          type: "button",
          style:
            "padding: 6px 10px; border-radius: 8px; border: 1px solid #d1d5db; background: #111827; color: #fff; cursor: pointer;",
          onClick: triggerInterrupt,
        },
        "Trigger interrupt",
      );
  },
});

const DefaultChatRouteContent = defineComponent({
  name: "DefaultChatRouteContent",
  setup() {
    useConfigureSuggestions({
      instructions: "Suggest follow-up tasks based on the current page content",
      available: "always",
    });

    useAgentContext({
      description: "The current Thread ID is:",
      value: computed(() => selectedThreadId.value),
    });

    useFrontendTool({
      name: "sayHello",
      parameters: z.object({
        name: z.string(),
      }),
      handler: async ({ name }) => {
        if (typeof window !== "undefined") {
          window.alert(`Hello ${name}`);
        }
        return `Hello ${name}`;
      },
    });

    return () =>
      h(CopilotChat, {
        threadId: selectedThreadId.value,
        inputToolsMenu: toolsMenu,
        onError: handleChatError,
      }, {
        interrupt: ({ event, result, resolve }) =>
          h(
            "div",
            {
              style:
                "padding: 10px; margin: 10px; border-radius: 10px; border: 1px solid #d1d5db; background: #f9fafb;",
            },
            [
              h("strong", { style: "display: block; margin-bottom: 4px;" }, "Interrupt"),
              h("div", { style: "font-size: 13px;" }, String((event as { value?: { prompt?: string } }).value?.prompt ?? "")),
              h("div", { style: "font-size: 12px; color: #4b5563; margin-top: 6px;" }, String((result as { label?: string } | null)?.label ?? "")),
              h(
                "button",
                {
                  type: "button",
                  style:
                    "margin-top: 8px; padding: 6px 10px; border-radius: 8px; border: 1px solid #111827; background: #111827; color: #fff;",
                  onClick: () => resolve({ approved: true, source: "vue-demo" }),
                },
                "Resolve interrupt",
              ),
            ],
          ),
      });
  },
});

function threadButtonStyle(threadId: typeof selectedThreadId.value) {
  const isActive = threadId === selectedThreadId.value;
  return {
    padding: "6px 14px",
    borderRadius: "20px",
    border: isActive ? "2px solid #111827" : "1px solid #d1d5db",
    backgroundColor: isActive ? "#111827" : "#ffffff",
    color: isActive ? "#ffffff" : "#111827",
    fontWeight: 600,
    fontSize: "0.85rem",
    cursor: "pointer",
    transition: "all 0.15s ease-in-out",
  };
}
</script>

<template>
  <CopilotKitProvider
    runtime-url="/api/copilotkit"
    :self-managed-agents="{ default: selfManagedDemoAgent }"
    :on-error="handleProviderError"
    show-dev-console="auto"
  >
    <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden">
      <div style="display: flex; flex-direction: column; height: 100%; padding: 16px; gap: 16px">
        <div
          style="border: 1px solid #e5e7eb; border-radius: 12px; padding: 10px 12px; background: #f9fafb; font-size: 12px; color: #111827;"
        >
          <strong>Error parity:</strong>
          <span> using </span>
          <code>CopilotKitProvider.onError</code>
          <span> and </span>
          <code>CopilotChat.onError</code>
          <EmitSyntheticErrors />
          <div style="margin-top: 8px;">
            <strong>Interrupt slot</strong>
          </div>
          <TriggerSyntheticInterrupt />
          <ul style="margin-top: 8px; padding-left: 18px;">
            <li v-if="interruptResolveLog.length === 0">No interrupt resolutions yet</li>
            <li v-for="entry in interruptResolveLog" :key="entry">{{ entry }}</li>
          </ul>
          <div style="margin-top: 8px;">
            <strong>Provider errors</strong>
          </div>
          <ul style="margin-top: 8px; padding-left: 18px;">
            <li v-if="providerErrorLog.length === 0">No provider errors yet</li>
            <li v-for="entry in providerErrorLog" :key="entry">{{ entry }}</li>
          </ul>
          <div style="margin-top: 8px;">
            <strong>Chat errors (default agent only)</strong>
          </div>
          <ul style="margin-top: 8px; padding-left: 18px;">
            <li v-if="chatErrorLog.length === 0">No chat errors yet</li>
            <li v-for="entry in chatErrorLog" :key="entry">{{ entry }}</li>
          </ul>
        </div>
        <div style="display: flex; gap: 10px; justify-content: center">
          <button
            v-for="thread in threadOptions"
            :key="thread.id"
            type="button"
            :aria-pressed="thread.id === selectedThreadId"
            :style="threadButtonStyle(thread.id)"
            @click="selectedThreadId = thread.id"
          >
            {{ thread.label }}
          </button>
        </div>
        <div style="flex: 1; min-height: 0">
          <DefaultChatRouteContent />
        </div>
      </div>
    </div>
  </CopilotKitProvider>
</template>
