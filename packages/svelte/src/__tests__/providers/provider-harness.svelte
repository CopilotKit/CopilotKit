<script lang="ts">
  import CopilotKitProvider from "../../providers/CopilotKitProvider.svelte";
  import ProviderConsumer from "./provider-consumer.svelte";
  import ProviderFrontendToolConsumer from "./provider-frontend-tool-consumer.svelte";

  let runtimeUrl = $state("https://runtime-a.test");
  let headers = $state<Record<string, string>>({ "X-Test": "a" });
</script>

<button data-testid="update-provider" onclick={() => {
  runtimeUrl = "https://runtime-b.test";
  headers = { "X-Test": "b" };
}}>update</button>
<CopilotKitProvider {runtimeUrl} {headers} publicApiKey="ck_pub_test">
  <ProviderConsumer />
  <ProviderFrontendToolConsumer />
</CopilotKitProvider>
