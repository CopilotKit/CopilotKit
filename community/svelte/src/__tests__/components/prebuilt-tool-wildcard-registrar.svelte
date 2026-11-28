<script lang="ts">
  import type { Message } from "@ag-ui/core";
  import CopilotChatMessageView from "../../components/chat/CopilotChatMessageView.svelte";
  import { registerRenderToolCall } from "../../hooks/register-render-tool-call.svelte";

  const messages: Message[] = [
    {
      id: "assistant-wild",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "audit-1",
          type: "function",
          function: {
            name: "audit",
            arguments: "{}",
          },
        },
      ],
    },
  ];

  registerRenderToolCall({
    name: "*",
    agentId: "other-agent",
    render: () => "wild-other",
  });

  registerRenderToolCall({
    name: "*",
    render: (props) => `wild:${props.name}:${props.toolCallId}`,
  });
</script>

<CopilotChatMessageView {messages} isRunning={false} />
