<script lang="ts">
  import type { AssistantMessage } from "@ag-ui/core";
  import CopilotChatMessageView from "../../components/chat/CopilotChatMessageView.svelte";
  import CopilotKitProvider from "../../providers/CopilotKitProvider.svelte";

  const messages: AssistantMessage[] = [
    {
      id: "assistant-tool-only",
      role: "assistant",
      toolCalls: [
        {
          id: "tool-call-1",
          type: "function",
          function: {
            name: "lookupWeather",
            arguments: '{"city":"London"}',
          },
        },
      ],
    },
  ];
</script>

<CopilotKitProvider agents__unsafe_dev_only={{}}>
  <CopilotChatMessageView {messages} isRunning={false} />
</CopilotKitProvider>
