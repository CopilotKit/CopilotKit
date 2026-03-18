<script setup lang="ts">
import { AbstractAgent, type BaseEvent, type RunAgentParameters, type RunAgentResult } from "@ag-ui/client";
import { Observable } from "rxjs";
import { computed, defineComponent, h, ref } from "vue";
import { z } from "zod";
import {
  CopilotChat,
  CopilotKitProvider,
  useAgentContext,
  useConfigureSuggestions,
  useFrontendTool,
  type ToolsMenuItem,
} from "@copilotkitnext/vue";

const selectedThreadId = ref<"thread---a" | "thread---b" | "thread---c">("thread---a");
const providerErrorLog = ref<string[]>([]);

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
          <strong>Provider parity:</strong>
          <span> using </span>
          <code>selfManagedAgents</code>
          <span> + </span>
          <code>onError</code>
          <ul style="margin-top: 8px; padding-left: 18px;">
            <li v-if="providerErrorLog.length === 0">No provider errors yet</li>
            <li v-for="entry in providerErrorLog" :key="entry">{{ entry }}</li>
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
