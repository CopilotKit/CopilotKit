<script lang="ts">
  import type { AssistantMessage, Message, ToolCall, ToolMessage } from "@ag-ui/core";
  import { ToolCallStatus } from "@copilotkit/core";
  import { DEFAULT_AGENT_ID, partialJSONParse } from "@copilotkit/shared";
  import type { Snippet } from "svelte";
  import { useCopilotKit } from "../../providers/useCopilotKit";
  import type {
    SvelteToolCallRenderer,
    SvelteToolCallRendererRenderProps,
  } from "../../types";
  import type { CopilotChatToolCallRenderSlotProps } from "./types";
  import { getChatConfig } from "./chat-config-context.svelte";
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
  const chatConfig = getChatConfig();

  let renderToolCalls = $state<SvelteToolCallRenderer<unknown>[]>([]);

  $effect(() => {
    const core = copilotkit;
    renderToolCalls = [...(core.renderToolCalls ?? [])];
    const subscription = core.subscribe({
      onRenderToolCallsChanged: (event) => {
        renderToolCalls = [...(event.renderToolCalls ?? [])];
      },
    });
    return () => subscription.unsubscribe();
  });

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

  function toolArgs(raw: string): Record<string, unknown> {
    const parsed = partialJSONParse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  }

  function matchRenderer(
    name: string,
    agentId: string,
  ): SvelteToolCallRenderer<unknown> | undefined {
    const scoped = renderToolCalls.find(
      (entry) => entry.name === name && entry.agentId === agentId,
    );
    if (scoped) return scoped;
    return renderToolCalls.find((entry) => entry.name === name && !entry.agentId);
  }

  function resolveRenderer(
    toolName: string,
  ): SvelteToolCallRenderer<unknown> | undefined {
    const agentId = chatConfig?.agentId || DEFAULT_AGENT_ID;
    return matchRenderer(toolName, agentId) ?? matchRenderer("*", agentId);
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

  function getCoreRenderProps(
    tc: ToolCall,
  ): SvelteToolCallRendererRenderProps<unknown> {
    const toolMessage = findToolMessage(tc.id);
    const args = toolArgs(tc.function.arguments);

    if (toolMessage) {
      return {
        name: tc.function.name,
        toolCallId: tc.id,
        args,
        status: ToolCallStatus.Complete,
        result: toolMessage.content,
      };
    }

    if (isExecuting(tc.id)) {
      return {
        name: tc.function.name,
        toolCallId: tc.id,
        args,
        status: ToolCallStatus.Executing,
        result: undefined,
      };
    }

    return {
      name: tc.function.name,
      toolCallId: tc.id,
      args,
      status: ToolCallStatus.InProgress,
      result: undefined,
    };
  }

  function asSnippet(value: unknown): Snippet {
    return value as Snippet;
  }
</script>

{#each message.toolCalls ?? [] as tc (tc.id)}
  {#if toolCall}
    {@render toolCall(getRenderProps(tc))}
  {:else}
    {@const renderer = resolveRenderer(tc.function.name)}
    {#if renderer}
      {@const rendered = renderer.render(getCoreRenderProps(tc))}
      {#if typeof rendered === "string" || typeof rendered === "number"}
        {rendered}
      {:else if typeof rendered === "function"}
        {@render asSnippet(rendered)()}
      {/if}
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
  {/if}
{/each}
