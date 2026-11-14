<script lang="ts">
  import { tick } from "svelte";
  import type { Message } from "@ag-ui/core";
  import CopilotChatMessage from "./CopilotChatMessage.svelte";
  import { normalizeAutoScroll, type AutoScrollMode } from "./types";

  let {
    messages = [] as Message[],
    isRunning = false,
    autoScroll = true as AutoScrollMode | boolean,
    sentMessageId = null,
  }: {
    messages?: Message[];
    isRunning?: boolean;
    autoScroll?: AutoScrollMode | boolean;
    sentMessageId?: string | null;
  } = $props();

  let container: HTMLDivElement | undefined = $state();
  const autoScrollMode = $derived(normalizeAutoScroll(autoScroll));
  let handledSentMessageId: string | null = null;

  $effect(() => {
    if (!container) return;
    if (autoScrollMode === "pin-to-bottom") {
      void messages;
      void isRunning;
      queueMicrotask(() => {
        container!.scrollTop = container!.scrollHeight;
      });
    } else if (
      autoScrollMode === "pin-to-send" &&
      sentMessageId &&
      sentMessageId !== handledSentMessageId
    ) {
      handledSentMessageId = sentMessageId;
      void tick().then(() => {
        const sentMessage = [...(container?.querySelectorAll<HTMLElement>(
          "[data-message-id]",
        ) ?? [])].find((element) => element.dataset.messageId === sentMessageId);
        if (sentMessage && container) {
          const containerTop = container.getBoundingClientRect().top;
          const messageTop = sentMessage.getBoundingClientRect().top;
          container.scrollTop += messageTop - containerTop;
        }
      });
    }
  });
</script>

<div bind:this={container} class="copilotkit-message-list">
  {#each messages as msg (msg.id)}
      <CopilotChatMessage message={msg} {messages} {isRunning} />
  {/each}
</div>

<style>
  .copilotkit-message-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }
</style>
