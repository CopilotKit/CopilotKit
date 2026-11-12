<script setup lang="ts">
import { defineComponent } from "vue";
import {
  CopilotChat,
  CopilotKitProvider,
  useConfigureSuggestions,
} from "@copilotkit/vue/v2";
import { standardUI } from "@copilotkit/vue/v2/generative-ui";

// The suggestions need the provider, so they are set in a child of
// `CopilotKitProvider`.
const Suggestions = defineComponent({
  name: "StandardCatalogSuggestions",
  setup() {
    // A config without `consumerAgentId` loads only for agents that exist
    // when it is added, and the runtime agents are not loaded yet at setup.
    // Naming the agent loads it at once (see /generative-ui).
    useConfigureSuggestions({
      available: "always",
      consumerAgentId: "default",
      suggestions: [
        {
          title: "Compare laptops",
          message:
            "Compare three laptops (Aero 14: $1299, 18h battery; Volt 16: $1599, 12h; Lite 13: $899, 20h) in a table inside a card with a title, and add a badge that marks the best value.",
        },
        {
          title: "Revenue chart",
          message:
            "Show monthly revenue for January to June as a bar chart in a card: 12, 15, 9, 18, 21, 24 (thousand dollars). Add a short caption under it.",
        },
        {
          title: "Trip form",
          message:
            "Show a small trip planning form in a card: a text field for the destination, a select for travel style (budget, comfort, luxury), a checkbox for travel insurance, and a Plan trip button.",
        },
      ],
    });
    return () => null;
  },
});
</script>

<template>
  <CopilotKitProvider
    runtime-url="/api/copilotkit-generative-ui-standard"
    :generativeUI="{ ui: standardUI }"
  >
    <Suggestions />
    <div class="h-screen mx-auto max-w-3xl">
      <CopilotChat />
    </div>
  </CopilotKitProvider>
</template>
