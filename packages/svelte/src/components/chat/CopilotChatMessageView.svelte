<script lang="ts">
  import type { Message } from "@ag-ui/core";
  import CopilotChatMessage from "./CopilotChatMessage.svelte";
  import { normalizeAutoScroll, type AutoScrollMode } from "./types";

  let {
    messages = [] as Message[],
    isRunning = false,
    autoScroll = true as AutoScrollMode | boolean,
  }: {
    messages?: Message[];
    isRunning?: boolean;
    autoScroll?: AutoScrollMode | boolean;
  } = $props();

  let container: HTMLDivElement | undefined = $state();
  const autoScrollMode = $derived(normalizeAutoScroll(autoScroll));

  $effect(() => {
    if (autoScrollMode !== "pin-to-bottom" || !container) return;
    messages;
    isRunning;
    queueMicrotask(() => {
      container!.scrollTop = container!.scrollHeight;
    });
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
