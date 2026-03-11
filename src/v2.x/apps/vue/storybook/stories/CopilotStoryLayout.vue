<script setup lang="ts">
import { CopilotChatConfigurationProvider, CopilotKitProvider } from "@copilotkitnext/vue";

withDefaults(
  defineProps<{
    threadId?: string;
    isModalDefaultOpen?: boolean;
  }>(),
  {
    threadId: "story-copilot-layout",
    isModalDefaultOpen: true,
  },
);
</script>

<template>
  <CopilotKitProvider runtime-url="https://copilotkit.ai">
    <CopilotChatConfigurationProvider
      :thread-id="threadId"
      :is-modal-default-open="isModalDefaultOpen"
    >
      <div style="min-height: 100vh; background: var(--color-background, #fff); color: var(--color-foreground, #020617)">
        <div
          style="
            margin: 0 auto;
            max-width: 1024px;
            display: grid;
            grid-template-columns: 1fr;
            gap: 24px;
            padding: 40px 24px;
          "
        >
          <section style="display:flex; flex-direction:column; gap:16px">
            <h1 style="margin: 0; font-size: 30px; font-weight: 600; letter-spacing: -0.02em">
              Project Dashboard
            </h1>
            <p style="margin: 0; color: #64748b">
              Toggle the assistant to draft updates, summarize discussions, and keep track of action items while you stay in context.
            </p>
          </section>

          <div
            style="
              display:grid;
              gap:16px;
              grid-template-columns: repeat(2, minmax(0, 1fr));
            "
          >
            <article
              v-for="index in 4"
              :key="index"
              style="
                border: 1px solid var(--color-border, #e2e8f0);
                border-radius: 12px;
                background: var(--color-card, #fff);
                padding: 16px;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
              "
            >
              <h2 style="margin: 0; font-size: 18px; font-weight: 500">Task {{ index }}</h2>
              <p style="margin: 8px 0 0; font-size: 14px; color: #64748b">
                Placeholder content to illustrate how the assistant integrates alongside your existing workflow.
              </p>
            </article>
          </div>
        </div>
        <slot />
      </div>
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
</template>
