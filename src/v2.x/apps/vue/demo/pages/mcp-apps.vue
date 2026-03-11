<script setup lang="ts">
import { CopilotKitProvider, CopilotSidebar } from "@copilotkitnext/vue";

const demoCards = Array.from({ length: 4 }, (_unused, index) => index + 1);
const mcpServerSetup = `git clone https://github.com/modelcontextprotocol/ext-apps
cd ext-apps
npm install
npm start`;
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit-mcp" show-dev-console="auto">
    <div class="relative min-h-screen bg-gradient-to-br from-slate-100 via-white to-slate-200">
      <main class="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
        <section class="space-y-4">
          <h1 class="text-3xl font-semibold tracking-tight text-slate-900">MCP Apps Demo</h1>
          <p class="max-w-2xl text-slate-600">
            This page demonstrates the MCP Apps Extension. The assistant has access to MCP tools that can render
            interactive UI components directly in the chat.
          </p>
          <div class="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
            <p class="font-medium text-slate-900">Available MCP Tools (ext-apps):</p>
            <ul class="mt-2 list-inside list-disc space-y-1">
              <li><code class="rounded bg-slate-100 px-1">get-time</code> - Current server time</li>
              <li><code class="rounded bg-slate-100 px-1">get-budget-data</code> - Interactive budget allocation</li>
              <li><code class="rounded bg-slate-100 px-1">get-cohort-data</code> - Cohort analysis heatmap</li>
              <li><code class="rounded bg-slate-100 px-1">get-customer-data</code> - Customer segmentation analysis</li>
              <li><code class="rounded bg-slate-100 px-1">get-scenario-data</code> - SaaS financial scenario modeling</li>
              <li><code class="rounded bg-slate-100 px-1">play-sheet-music</code> - Music notation rendering</li>
              <li><code class="rounded bg-slate-100 px-1">get-system-stats</code> - System monitoring dashboard</li>
              <li><code class="rounded bg-slate-100 px-1">show_threejs_scene</code> - 3D visualization (Three.js)</li>
              <li><code class="rounded bg-slate-100 px-1">play_video</code> - Video player</li>
              <li><code class="rounded bg-slate-100 px-1">get-first-degree-links</code> - Wikipedia link explorer</li>
            </ul>
            <div class="mt-3 space-y-1 text-xs text-slate-500">
              <p class="font-medium">To run the MCP servers:</p>
              <pre class="overflow-x-auto rounded bg-slate-100 p-2">{{ mcpServerSetup }}</pre>
            </div>
          </div>
        </section>

        <section class="grid gap-6 md:grid-cols-2">
          <article
            v-for="index in demoCards"
            :key="index"
            class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md"
          >
            <h2 class="text-lg font-medium text-slate-900">Demo Card {{ index }}</h2>
            <p class="mt-2 text-sm text-slate-600">
              Try asking the assistant to use MCP tools. The UI will render directly in the chat sidebar.
            </p>
          </article>
        </section>
      </main>

      <CopilotSidebar default-open width="50%" thread-id="mcp-apps-003" />
    </div>
  </CopilotKitProvider>
</template>
