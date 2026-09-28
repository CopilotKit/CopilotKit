<script lang="ts">
  import {
    CopilotKitCoreRuntimeConnectionStatus,
    type CopilotRuntimeTransport,
    type IntelligenceRuntimeInfo,
    type ThreadEndpointRuntimeInfo,
  } from "@copilotkit/core";
  import { setContext } from "svelte";
  import { createThreads } from "../../hooks/create-threads.svelte";
  import type { CopilotKitCoreSvelte } from "../../lib/svelte-core";
  import {
    COPILOT_KIT_KEY,
    type CopilotKitContextValue,
  } from "../../providers/context";

  const LIVE_URL = "https://runtime.local/api/copilotkit";
  const LIVE_TOKEN = "live-token";

  let {
    core,
    initialAgentId = "agent-1",
    initialEnabled = true,
  }: {
    core: CopilotKitCoreSvelte;
    initialAgentId?: string;
    initialEnabled?: boolean;
  } = $props();

  // svelte-ignore state_referenced_locally
  let agentId = $state(initialAgentId);
  // svelte-ignore state_referenced_locally
  let enabled = $state(initialEnabled);
  let includeArchived = $state<boolean | undefined>(undefined);
  let limit = $state<number | undefined>(undefined);
  let runtimeUrl = $state<string | undefined>(undefined);
  let runtimeStatus =
    $state<CopilotKitCoreRuntimeConnectionStatus>(
      CopilotKitCoreRuntimeConnectionStatus.Disconnected,
    );
  let headers = $state<Record<string, string>>({});
  let threadEndpoints = $state<ThreadEndpointRuntimeInfo | undefined>(undefined);
  let intelligence = $state<IntelligenceRuntimeInfo | undefined>(undefined);

  setContext<CopilotKitContextValue>(COPILOT_KIT_KEY, {
    get copilotkit() {
      return core;
    },
    get executingToolCallIds() {
      return new Set<string>();
    },
    get agents() {
      return {};
    },
    get runtimeConnectionStatus() {
      return runtimeStatus;
    },
    get runtimeUrl() {
      return runtimeUrl;
    },
    get runtimeTransport() {
      return "auto" as CopilotRuntimeTransport;
    },
    get headers() {
      return headers;
    },
    get threadEndpoints() {
      return threadEndpoints;
    },
    get intelligence() {
      return intelligence;
    },
    get licenseStatus() {
      return undefined;
    },
  });

  const threadsResult = createThreads({
    get agentId() {
      return agentId;
    },
    get enabled() {
      return enabled;
    },
    get includeArchived() {
      return includeArchived;
    },
    get limit() {
      return limit;
    },
  });

  const rendered = $derived(
    JSON.stringify({
      threadIds: threadsResult.threads.map((thread) => thread.id),
      isLoading: threadsResult.isLoading,
      error: threadsResult.error?.message ?? null,
      listError: threadsResult.listError?.message ?? null,
    }),
  );

  function connect() {
    threadEndpoints = {
      list: true,
      inspect: true,
      mutations: true,
      realtimeMetadata: false,
    };
    headers = { Authorization: `Bearer ${LIVE_TOKEN}` };
    runtimeUrl = LIVE_URL;
    runtimeStatus = CopilotKitCoreRuntimeConnectionStatus.Connected;
  }
</script>

<output data-testid="threads">{rendered}</output>
<button data-testid="connect" onclick={connect}>connect</button>
<button data-testid="set-agent-2" onclick={() => (agentId = "agent-2")}>agent2</button>
<button data-testid="disable" onclick={() => (enabled = false)}>disable</button>
<button data-testid="enable" onclick={() => (enabled = true)}>enable</button>
<button
  data-testid="rotate-headers"
  onclick={() => {
    headers = { Authorization: "Bearer rotated-token" };
  }}
>
  rotate-headers
</button>
<button
  data-testid="hide-endpoints"
  onclick={() => {
    threadEndpoints = {
      list: false,
      inspect: false,
      mutations: false,
      realtimeMetadata: false,
    };
  }}
>
  hide-endpoints
</button>
<button data-testid="show-endpoints" onclick={connect}>show-endpoints</button>
<button
  data-testid="clear-url"
  onclick={() => {
    runtimeUrl = undefined;
  }}
>
  clear-url
</button>
<button
  data-testid="set-limit"
  onclick={() => {
    limit = 1;
  }}
>
  set-limit
</button>
<button
  data-testid="set-archived"
  onclick={() => {
    includeArchived = true;
  }}
>
  set-archived
</button>
