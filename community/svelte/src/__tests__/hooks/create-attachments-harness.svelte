<script lang="ts">
  import { createAttachments, type CreateAttachmentsProps } from "../../hooks/create-attachments.svelte";

  let { config }: { config: CreateAttachmentsProps["config"] } = $props();

  // svelte-ignore state_referenced_locally
  const att = createAttachments({ config });
  const rendered = $derived(JSON.stringify({
    attachments: att.attachments,
    enabled: att.enabled,
    dragOver: att.dragOver,
  }));
</script>

<output data-testid="attachments">{rendered}</output>
