<script lang="ts">
	import { z } from "zod";
	import {
		CopilotChat,
		connectAgentContext,
		registerFrontendTool,
	} from "@copilotkit/svelte";

	connectAgentContext({
    description: "The user is testing the Svelte CopilotKit package on the chat demo page.",
  });

	registerFrontendTool({
    name: "showToast",
    description: "Show a toast notification to the user",
    parameters: z.object({
      message: z.string().describe("The message to display"),
      type: z.enum(["success", "error", "info"]).describe("The type of toast"),
    }),
    handler: async ({ message, type }) => {
      alert(`[${type.toUpperCase()}] ${message}`);
      return `Toast shown: ${message}`;
    },
  });
</script>

<div class="chat-panel">
  <CopilotChat welcomeScreen={true} />
</div>

<style>
  .chat-panel {
    flex: 1;
    background: #fff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }
</style>
