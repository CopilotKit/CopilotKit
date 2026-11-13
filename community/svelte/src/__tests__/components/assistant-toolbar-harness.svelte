<script lang="ts">
  import type { AssistantMessage, Message } from "@ag-ui/core";
  import CopilotKitProvider from "../../providers/CopilotKitProvider.svelte";
  import CopilotChatAssistantMessage from "../../components/chat/CopilotChatAssistantMessage.svelte";

  const assistantMessage = {
    id: "assistant-1",
    role: "assistant",
    content: "Still streaming",
  } as AssistantMessage;
  const messages = [
    assistantMessage,
    {
      id: "tool-1",
      role: "tool",
      toolCallId: "call-1",
      content: "tool result",
    },
  ] as Message[];
</script>

<CopilotKitProvider runtimeUrl="https://runtime.test">
  <CopilotChatAssistantMessage
    message={assistantMessage}
    {messages}
    isRunning={true}
  />
</CopilotKitProvider>
