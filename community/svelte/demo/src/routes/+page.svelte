<script lang="ts">
  import { CopilotKitProvider } from "@copilotkit/svelte";
  import ChatDemo from "$lib/ChatDemo.svelte";
</script>

<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  showDevConsole={true}
>
  <div class="app">
    <header class="header">
      <div>
        <h1>CopilotKit Svelte 5</h1>
        <p>AI chat with agent calling, tool rendering, reasoning, and suggestions</p>
      </div>
    </header>

    <main class="main">
      <ChatDemo />
    </main>
  </div>
</CopilotKitProvider>

<style>
  :global(*) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  :global(html, body) {
    height: 100%;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #f1f5f9;
  }

  .app {
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .header {
    padding: 16px 24px;
    background: #fff;
    border-bottom: 1px solid #e2e8f0;
    flex-shrink: 0;
  }

  .header h1 {
    font-size: 18px;
    font-weight: 700;
    color: #0f172a;
    letter-spacing: -0.02em;
  }

  .header p {
    font-size: 13px;
    color: #64748b;
    margin-top: 2px;
  }

  .main {
    flex: 1;
    overflow: hidden;
    padding: 16px;
    display: flex;
    flex-direction: column;
  }
</style>
