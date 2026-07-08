<script lang="ts">
  import { useAgent } from "@copilotkit/svelte";

  let input = $state("");
  let { agent } = useAgent();
  let messages = $derived(agent?.messages ?? []);
  let isLoading = $derived(agent?.status === "in_progress");

  async function send() {
    if (!input.trim() || !agent) return;
    agent.appendMessage({ role: "user", content: input.trim() });
    input = "";
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
</script>

<div class="messages">
  {#each messages as msg (msg.id)}
    <div class="message {msg.role}">
      <strong>{msg.role}:</strong>
      <span>{typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)}</span>
    </div>
  {/each}
  {#if isLoading}
    <div class="message assistant">
      <em>Thinking...</em>
    </div>
  {/if}
</div>

<div class="input-row">
  <textarea
    bind:value={input}
    onkeydown={keydown}
    placeholder="Type a message..."
    rows="1"
  ></textarea>
  <button onclick={send} disabled={isLoading || !input.trim()}>
    Send
  </button>
</div>
