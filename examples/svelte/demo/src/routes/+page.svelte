<script lang="ts">
  import { CopilotKitProvider } from "@copilotkit/svelte";
  import Chat from "./Chat.svelte";
</script>

<CopilotKitProvider runtimeUrl="/api/copilotkit">
  <div class="chat-container">
    <header>
      <h1>CopilotKit Svelte Demo</h1>
    </header>
    <main>
      <Chat />
    </main>
  </div>
</CopilotKitProvider>
