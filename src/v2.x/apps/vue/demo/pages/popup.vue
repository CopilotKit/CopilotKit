<script setup lang="ts">
import { defineComponent, h } from "vue";
import { z } from "zod";
import { CopilotKitProvider, CopilotPopup, useConfigureSuggestions, useFrontendTool } from "@copilotkitnext/vue";

const popupCards = Array.from({ length: 6 }, (_unused, index) => index + 1);

const PopupChat = defineComponent({
  name: "PopupChat",
  setup() {
    useConfigureSuggestions({
      instructions: "Suggest short summaries or next actions based on the dashboard content",
      available: "always",
      maxSuggestions: 2,
    });

    useFrontendTool({
      name: "notify",
      parameters: z.object({
        message: z.string(),
      }),
      handler: async ({ message }) => {
        if (typeof window !== "undefined") {
          window.alert(`Notification: ${message}`);
        }
        return `Displayed notification: ${message}`;
      },
    });

    return () => h(CopilotPopup, { defaultOpen: true, clickOutsideToClose: true });
  },
});
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit" show-dev-console="auto">
    <div class="relative min-h-screen bg-gradient-to-br from-slate-100 via-white to-slate-200">
      <main class="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12 pb-40">
        <section class="space-y-4">
          <span class="inline-flex items-center rounded-full bg-slate-900/10 px-3 py-1 text-xs font-medium text-slate-700">
            Overlay Chat Demo
          </span>
          <h1 class="text-3xl font-semibold tracking-tight text-slate-900">Copilot Popup Demo</h1>
          <p class="max-w-2xl text-slate-600">
            This page mounts the chat as a floating popup anchored to the bottom-right corner. The popup animates in
            and out, and leaves the rest of the interface interactive. Try clicking outside the popup or using the
            toggle button to open and close the assistant.
          </p>
        </section>

        <section class="grid gap-6 md:grid-cols-2">
          <article
            v-for="index in popupCards"
            :key="index"
            class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md"
          >
            <h2 class="text-lg font-medium text-slate-900">In-Flow Task {{ index }}</h2>
            <p class="mt-2 text-sm text-slate-600">
              Use the popup assistant to draft updates, summarize status, or trigger custom tools without losing
              context.
            </p>
          </article>
        </section>

        <section class="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-6 shadow-inner">
          <h3 class="text-base font-semibold text-slate-900">How the popup behaves</h3>
          <ul class="mt-3 space-y-2 text-sm text-slate-600">
            <li>• Appears with a bottom-right scale and translate animation.</li>
            <li>• Leaves the page scrollable and interactive—no backdrop overlay.</li>
            <li>• Supports closing when you click outside (enabled in this demo).</li>
            <li>• Reuses all chat slots, tools, and suggestion hooks from the core chat.</li>
          </ul>
        </section>
      </main>

      <PopupChat />
    </div>
  </CopilotKitProvider>
</template>
