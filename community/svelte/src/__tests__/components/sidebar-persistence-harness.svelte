<script lang="ts">
  import { setContext } from "svelte";
  import CopilotSidebar from "../../components/chat/CopilotSidebar.svelte";
  import type { CopilotKitCoreSvelte } from "../../lib/svelte-core";
  import {
    COPILOT_KIT_KEY,
    type CopilotKitContextValue,
  } from "../../providers/context";

  let { core }: { core: CopilotKitCoreSvelte } = $props();

  const context: CopilotKitContextValue = {
    get copilotkit() {
      return core;
    },
    executingToolCallIds: new Set<string>(),
    get agents() {
      return core.agents;
    },
    get runtimeConnectionStatus() {
      return core.runtimeConnectionStatus;
    },
    get runtimeUrl() {
      return core.runtimeUrl;
    },
    get runtimeTransport() {
      return core.runtimeTransport;
    },
    get headers() {
      return core.headers;
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
  };

  setContext(COPILOT_KIT_KEY, context);

  let inputValue = $state("");
</script>

<CopilotSidebar
  defaultOpen={true}
  welcomeScreen={false}
  {inputValue}
  onInputChange={(value) => (inputValue = value)}
/>
