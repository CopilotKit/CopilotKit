<script lang="ts">
  import type { AbstractAgent } from "@ag-ui/client";
  import type { Message } from "@ag-ui/core";
  import CopilotKitProvider from "../../providers/CopilotKitProvider.svelte";
  import CopilotChat from "../../components/chat/CopilotChat.svelte";

  class TestAgent {
    agentId = "default";
    messages: Message[] = [];
    state: Record<string, unknown> = {};
    isRunning = false;
    threadId?: string;

    clone() {
      return new TestAgent();
    }

    setMessages() {}
    setState() {}
    subscribe() {
      return { unsubscribe() {} };
    }
  }

  let inputValue = $state("first draft");
  const agents = { default: new TestAgent() as unknown as AbstractAgent };
</script>

<button data-testid="update-chat-input" onclick={() => (inputValue = "updated draft")}>update</button>
<output data-testid="chat-input-value">{inputValue}</output>
<CopilotKitProvider runtimeUrl="https://runtime.test" selfManagedAgents={agents}>
  <CopilotChat
    {inputValue}
    onInputChange={(value) => (inputValue = value)}
    welcomeScreen={false}
  />
</CopilotKitProvider>
