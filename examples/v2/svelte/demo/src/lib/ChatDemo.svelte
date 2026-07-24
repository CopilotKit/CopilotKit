<script lang="ts">
  import { z } from "zod";
  import {
    CopilotChat,
    CopilotSidebar,
    CopilotPopup,
    connectAgentContext,
    registerFrontendTool,
  } from "@copilotkit/svelte";

  type Tab = "chat" | "sidebar" | "popup";
  let activeTab = $state<Tab>("chat");

  $effect(() => {
    connectAgentContext({
      description: "The user is testing the Svelte CopilotKit package on the chat demo page.",
      value: activeTab,
    });
  });

  registerFrontendTool({
    name: "showToast",
    description: "Show a toast notification to the user",
    parameters: z.object({
      message: z.string().describe("The message to display"),
      type: z.enum(["success", "error", "info"]).describe("The type of toast"),
    }),
    handler: async ({ message, type }) => {
      alert(`[${type.toUpperCase()}] ${message}`);
      return `Toast shown: ${message}`;
    },
  });

  const tabs: { id: Tab; label: string }[] = [
    { id: "chat", label: "Chat" },
    { id: "sidebar", label: "Sidebar" },
    { id: "popup", label: "Popup" },
  ];
</script>

<div class="demo">
  <nav class="tabs">
    {#each tabs as tab (tab.id)}
      <button
        class="tab"
        class:active={activeTab === tab.id}
        onclick={() => activeTab = tab.id}
      >
        {tab.label}
      </button>
    {/each}
  </nav>

  <div class="view">
    {#key activeTab}
      {#if activeTab === "chat"}
        <div class="chat-panel">
          <CopilotChat welcomeScreen={true} />
        </div>
      {:else if activeTab === "sidebar"}
        <CopilotSidebar defaultOpen={true} welcomeScreen={true} />
      {:else if activeTab === "popup"}
        <CopilotPopup defaultOpen={true} welcomeScreen={true} />
      {/if}
    {/key}
  </div>
</div>

<style>
  .demo {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .tabs {
    display: flex;
    gap: 4px;
    background: #fff;
    border-bottom: 1px solid #e2e8f0;
    padding: 8px 16px;
    flex-shrink: 0;
  }

  .tab {
    padding: 8px 20px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #f8fafc;
    color: #64748b;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .tab:hover {
    background: #f1f5f9;
    color: #334155;
  }

  .tab.active {
    background: #3b82f6;
    color: #fff;
    border-color: #3b82f6;
  }

  .view {
    flex: 1;
    overflow: hidden;
    padding: 16px;
    display: flex;
    flex-direction: column;
  }

  .chat-panel {
    flex: 1;
    background: #fff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }
</style>
