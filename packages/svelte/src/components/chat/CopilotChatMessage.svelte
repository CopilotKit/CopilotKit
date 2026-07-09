<script lang="ts">
  import type { Message, AssistantMessage, UserMessage, ReasoningMessage } from "@ag-ui/core";
  import CopilotChatAssistantMessage from "./CopilotChatAssistantMessage.svelte";
  import CopilotChatUserMessage from "./CopilotChatUserMessage.svelte";
  import CopilotChatReasoningMessage from "./CopilotChatReasoningMessage.svelte";

  let {
    message,
    messages = [] as Message[],
    isRunning = false,
  }: {
    message: Message;
    messages?: Message[];
    isRunning?: boolean;
  } = $props();

  function isAssistant(msg: Message): msg is AssistantMessage {
    return msg.role === "assistant" && (msg as AssistantMessage).content !== undefined;
  }

  function isUser(msg: Message): msg is UserMessage {
    return msg.role === "user";
  }

  function isReasoning(msg: Message): msg is ReasoningMessage {
    return msg.role === "reasoning";
  }

  function isTool(msg: Message): boolean {
    return msg.role === "tool";
  }
</script>

{#if isReasoning(message)}
  <CopilotChatReasoningMessage {message} {messages} {isRunning} />
{:else if isAssistant(message)}
  <CopilotChatAssistantMessage {message} {messages} {isRunning} />
{:else if isUser(message)}
  <CopilotChatUserMessage {message} />
{/if}
