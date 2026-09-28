<script lang="ts">
  import type { AbstractAgent } from "@ag-ui/client";
  import type { Message } from "@ag-ui/core";
  import type { AttachmentsConfig } from "@copilotkit/shared";
  import CopilotKitProvider from "../../providers/CopilotKitProvider.svelte";
  import CopilotChat from "../../components/chat/CopilotChat.svelte";

  let {
    attachments,
    onSent,
  }: {
    attachments?: AttachmentsConfig | boolean;
    onSent?: (message: Message) => void;
  } = $props();

  class RecordingAgent {
    agentId = "default";
    messages: Message[] = [];
    state: Record<string, unknown> = {};
    isRunning = false;
    threadId?: string;

    clone() {
      return new RecordingAgent();
    }
    addMessage(message: Message) {
      this.messages.push(message);
      onSent?.(message);
    }
    setMessages() {}
    setState() {}
    abortRun() {}
    async detachActiveRun() {}
    subscribe() {
      return { unsubscribe() {} };
    }
  }

  const agent = new RecordingAgent() as unknown as AbstractAgent;
  const agents = { default: agent };
</script>

<CopilotKitProvider runtimeUrl="https://runtime.test" selfManagedAgents={agents}>
  <CopilotChat {attachments} welcomeScreen={false} />
</CopilotKitProvider>
