<script lang="ts">
  import type { Message } from "@ag-ui/core";
  import CopilotChatMessage from "./CopilotChatMessage.svelte";

  let {
    messages = [] as Message[],
    isRunning = false,
  }: {
    messages?: Message[];
    isRunning?: boolean;
  } = $props();
</script>

<div class="copilotkit-message-list">
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
