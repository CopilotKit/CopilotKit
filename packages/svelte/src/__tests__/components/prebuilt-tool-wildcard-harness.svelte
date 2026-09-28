<script lang="ts">
  import CopilotKitProvider from "../../providers/CopilotKitProvider.svelte";
  import Registrar from "./prebuilt-tool-wildcard-registrar.svelte";
</script>

<CopilotKitProvider agents__unsafe_dev_only={{}}>
  <Registrar />
</CopilotKitProvider>
