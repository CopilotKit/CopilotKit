<script setup lang="ts">
import { defineComponent, h } from "vue";
import { z } from "zod";
import {
  CopilotChat,
  CopilotKitProvider,
  useConfigureSuggestions,
  useFrontendTool,
  type ToolsMenuItem,
} from "@copilotkitnext/vue";

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

const SingleEndpointRouteContent = defineComponent({
  name: "SingleEndpointRouteContent",
  setup() {
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

    useConfigureSuggestions({
      instructions: "Suggest follow-up tasks based on the current page content",
    });

    return () => h(CopilotChat, { threadId: "xyz", inputToolsMenu: toolsMenu });
  },
});
</script>

<template>
  <CopilotKitProvider
    runtime-url="/api/copilotkit-single"
    :use-single-endpoint="true"
    show-dev-console="auto"
  >
    <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden">
      <SingleEndpointRouteContent />
    </div>
  </CopilotKitProvider>
</template>
