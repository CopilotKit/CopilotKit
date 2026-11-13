<script lang="ts">
  import { createAttachments } from "../../hooks/create-attachments.svelte";

  let enabled = $state(false);
  const att = createAttachments({ config: () => ({ enabled }) });
  const snapshot = $derived(JSON.stringify({ enabled: att.enabled }));
</script>

<button data-testid="toggle" onclick={() => (enabled = true)}>enable</button>
<output data-testid="reactive-state">{snapshot}</output>
