<script setup lang="ts">
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
  <CopilotKitProvider runtime-url="/api/copilotkit" show-dev-console="auto">
    <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden">
      <div style="display: flex; flex-direction: column; height: 100%; padding: 16px; gap: 16px">
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
