<script lang="ts">
  import type { AbstractAgent } from "@ag-ui/client";
  import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
  import { setContext } from "svelte";
  import { createAgent } from "../../hooks/create-agent.svelte";
  import type { CopilotKitCoreSvelte } from "../../lib/svelte-core";
  import {
    COPILOT_KIT_KEY,
    type CopilotKitContextValue,
  } from "../../providers/context";

  const LIVE_URL = "https://live.test";
  const HEADER_SEQUENCE = ["one", "two", "three"];

  let {
    core,
    initialAgents,
  }: {
    core: CopilotKitCoreSvelte;
    initialAgents: Record<string, AbstractAgent>;
  } = $props();

  let agentId = $state("agent-a");
  // svelte-ignore state_referenced_locally
  let registry = $state<Record<string, AbstractAgent>>({ ...initialAgents });
  let headerIndex = $state(0);
  let providerHeaders = $derived<Record<string, string>>({
    "X-Test": HEADER_SEQUENCE[headerIndex] ?? "one",
  });
  let connectionStatus =
    $state<CopilotKitCoreRuntimeConnectionStatus>(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
  let useThread = $state(false);

  setContext<CopilotKitContextValue>(COPILOT_KIT_KEY, {
    get copilotkit() {
      return core;
    },
    get executingToolCallIds() {
      return new Set<string>();
    },
    get agents() {
      return registry;
    },
    get runtimeConnectionStatus() {
      return connectionStatus;
    },
    get runtimeUrl() {
      return LIVE_URL;
    },
    get runtimeTransport() {
      return "auto" as const;
    },
    get headers() {
      return providerHeaders;
    },
    get threadEndpoints() {
      return undefined;
    },
    get intelligence() {
      return undefined;
    },
    get licenseStatus() {
      return undefined;
    },
  });

  const hook = createAgent({
    get agentId() {
      return agentId;
    },
    get threadId() {
      return useThread ? "thread-1" : undefined;
    },
  });

  const identity = $derived.by(() => {
    const current = hook.agent;
    if (!current) return "none";
    if (current === registry["agent-a"]) return "A";
    if (current === registry["agent-b"]) return "B";
    if (current.agentId === "ghost") return "provisional";
    return "clone";
  });
  const agentUrl = $derived(
    (hook.agent as unknown as { url?: unknown } | null)?.url ?? "",
  );
</script>

<output data-testid="reactive-agent-id">{hook.agent?.agentId ?? "none"}</output>
<output data-testid="reactive-agent-identity">{identity}</output>
<output data-testid="reactive-agent-url">{String(agentUrl)}</output>
<button data-testid="switch-agent" onclick={() => (agentId = "agent-b")}>switch</button>
<button
  data-testid="rotate-headers"
  onclick={() => {
    headerIndex = (headerIndex + 1) % HEADER_SEQUENCE.length;
    core.setHeaders(providerHeaders);
  }}
>
  rotate
</button>
<button data-testid="use-thread" onclick={() => (useThread = true)}>thread</button>
<button
  data-testid="go-ghost-offline"
  onclick={() => {
    agentId = "ghost";
    connectionStatus = CopilotKitCoreRuntimeConnectionStatus.Disconnected;
  }}
>
  ghost
</button>
