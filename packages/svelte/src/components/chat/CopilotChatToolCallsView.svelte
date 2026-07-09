<script lang="ts">
  import type { AssistantMessage, Message, ToolCall, ToolMessage } from "@ag-ui/core";
  import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
  import { ToolCallStatus } from "@copilotkit/core";
  import { partialJSONParse } from "@copilotkit/shared";
  import { useCopilotKit } from "../../providers/useCopilotKit";
  import { getChatConfig } from "./chat-config-context.svelte";
  import type { CopilotChatToolCallRenderSlotProps } from "./types";
  import type { Snippet } from "svelte";
  import { IconCheckCircle, IconCircle, IconLoader2 } from "../icons";

  let {
    message,
    messages = [] as Message[],
    toolCall,
  }: {
    message: AssistantMessage;
    messages?: Message[];
    toolCall?: Snippet<[CopilotChatToolCallRenderSlotProps]>;
  } = $props();

  const { copilotkit, executingToolCallIds } = useCopilotKit();

  function findToolMessage(toolCallId: string): ToolMessage | undefined {
    return messages.find(
      (msg) =>
        msg.role === "tool" &&
        (msg as ToolMessage).toolCallId === toolCallId,
    ) as ToolMessage | undefined;
  }

  function isExecuting(toolCallId: string): boolean {
    return executingToolCallIds.has(toolCallId);
  }

  function getToolResult(toolCallId: string): string | undefined {
    return findToolMessage(toolCallId)?.content;
  }

  function getRenderProps(tc: ToolCall): CopilotChatToolCallRenderSlotProps {
    const toolMessage = findToolMessage(tc.id);
    const parsedArgs = partialJSONParse(tc.function.arguments);

    if (toolMessage) {
      return {
        name: tc.function.name,
        args: parsedArgs,
        status: ToolCallStatus.Complete,
        result: toolMessage.content,
        toolCall: tc,
        toolMessage,
      };
    }

    return {
      name: tc.function.name,
      args: parsedArgs,
      status: isExecuting(tc.id) ? ToolCallStatus.Executing : ToolCallStatus.InProgress,
      result: undefined,
      toolCall: tc,
      toolMessage: undefined,
    };
  }
</script>

{#each message.toolCalls ?? [] as tc (tc.id)}
  {#if toolCall}
    {@render toolCall(getRenderProps(tc))}
  {:else}
    <div class="cpk:flex cpk:items-center cpk:gap-2 cpk:py-1 cpk:text-sm cpk:text-muted-foreground">
      {#if isExecuting(tc.id)}
        <IconLoader2 class="cpk:size-4 cpk:animate-spin" />
        <span>{tc.function.name}</span>
      {:else if getToolResult(tc.id)}
        <IconCheckCircle class="cpk:size-4 cpk:text-green-500" />
        <span>{tc.function.name}</span>
      {:else}
        <IconCircle class="cpk:size-4 cpk:text-muted-foreground" />
        <span>{tc.function.name}</span>
      {/if}
    </div>
  {/if}
{/each}
