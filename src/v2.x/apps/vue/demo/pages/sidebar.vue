<script setup lang="ts">
import { defineComponent, h } from "vue";
import { z } from "zod";
import { CopilotKitProvider, CopilotSidebar, useConfigureSuggestions, useFrontendTool } from "@copilotkitnext/vue";

const projectCards = Array.from({ length: 4 }, (_unused, index) => index + 1);

const SidebarChat = defineComponent({
  name: "SidebarChat",
  setup() {
    useConfigureSuggestions({
      instructions: "Suggest follow-up tasks based on the current page content",
      available: "always",
    });

    useFrontendTool({
      name: "toastNotification",
      parameters: z.object({
        message: z.string(),
      }),
      handler: async ({ message }) => {
        if (typeof window !== "undefined") {
          window.alert(`Notification: ${message}`);
        }
        return `Displayed toast: ${message}`;
      },
    });

    return () => h(CopilotSidebar, { defaultOpen: true, width: "50%" });
  },
});
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit" show-dev-console="auto">
    <div class="relative min-h-screen bg-gradient-to-br from-slate-100 via-white to-slate-200">
      <main class="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
        <section class="space-y-4">
          <h1 class="text-3xl font-semibold tracking-tight text-slate-900">Copilot Sidebar Demo</h1>
          <p class="max-w-2xl text-slate-600">
            This page shows the chat embedded as a right-aligned sidebar. Toggle the chat to see the main content
            reflow. The assistant can suggest actions and invoke custom tools just like the full-screen chat.
          </p>
        </section>

        <section class="grid gap-6 md:grid-cols-2">
          <article
            v-for="index in projectCards"
            :key="index"
            class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md"
          >
            <h2 class="text-lg font-medium text-slate-900">Project Card {{ index }}</h2>
            <p class="mt-2 text-sm text-slate-600">
              Placeholder content to demonstrate how the sidebar pushes layout elements without overlapping the page.
            </p>
          </article>
        </section>
      </main>

      <SidebarChat />
    </div>
  </CopilotKitProvider>
</template>
