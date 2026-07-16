<script lang="ts">
  import type { AbstractAgent } from "@ag-ui/client";
  import type { AssistantMessage } from "@ag-ui/core";
  import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
  import { setContext } from "svelte";
  import CopilotChat from "../../components/chat/CopilotChat.svelte";
  import type { CopilotKitCoreSvelte } from "../../lib/svelte-core";
  import {
    COPILOT_KIT_KEY,
    type CopilotKitContextValue,
  } from "../../providers/context";

  class TestAgent {
    agentId: string;
    messages: AssistantMessage[];
    state = {};
    isRunning = false;
    threadId?: string;

    constructor(agentId: string, content: string) {
      this.agentId = agentId;
      this.messages = [{ id: `${agentId}-message`, role: "assistant", content }];
    }

    clone() {
      return new TestAgent(this.agentId, this.messages[0]?.content as string);
    }

    setMessages() {}
    setState() {}
    subscribe() {
      return { unsubscribe() {} };
    }
  }

  let agentId = $state("agent-a");
  const agents = {
    "agent-a": new TestAgent("agent-a", "Response from agent A"),
    "agent-b": new TestAgent("agent-b", "Response from agent B"),
  } as unknown as Record<string, AbstractAgent>;
  const core = {
    agents,
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
    runtimeUrl: undefined,
    runtimeTransport: "auto",
    headers: {},
    getAgent: (id: string) => agents[id],
    subscribeToAgentWithOptions: (agent: AbstractAgent, subscriber: object) =>
      agent.subscribe(subscriber),
    getSuggestions: () => ({ suggestions: [], isLoading: false }),
    subscribe: () => ({ unsubscribe() {} }),
  } as unknown as CopilotKitCoreSvelte;
  const context = {
    copilotkit: core,
    executingToolCallIds: new Set<string>(),
    agents,
    runtimeConnectionStatus: core.runtimeConnectionStatus,
    runtimeUrl: core.runtimeUrl,
    runtimeTransport: core.runtimeTransport,
    headers: core.headers,
    threadEndpoints: undefined,
    intelligence: undefined,
    licenseStatus: undefined,
  } as CopilotKitContextValue;

  // svelte-ignore state_referenced_locally
  setContext(COPILOT_KIT_KEY, context);
</script>

<button data-testid="switch-chat-agent" onclick={() => (agentId = "agent-b")}>switch</button>
<CopilotChat {agentId} threadId="thread-1" welcomeScreen={false} />
