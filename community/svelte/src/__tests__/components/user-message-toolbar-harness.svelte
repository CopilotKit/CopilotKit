<script lang="ts">
  import type { UserMessage } from "@ag-ui/core";
  import CopilotChatUserMessage from "../../components/chat/CopilotChatUserMessage.svelte";

  const message: UserMessage = { id: "user-1", role: "user", content: "hello" };
</script>

<CopilotChatUserMessage {message}>
  {#snippet editButton({ onEdit, label })}
    <button aria-label={label} onclick={onEdit}>Custom edit</button>
  {/snippet}
</CopilotChatUserMessage>
