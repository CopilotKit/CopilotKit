<script lang="ts">
  import { createAttachments } from "../../hooks/create-attachments.svelte";
  import type { AttachmentsConfigInput } from "../../hooks/create-attachments.svelte";
  import type { AttachmentsConfig } from "@copilotkit/shared";

  let {
    config,
    files = [] as File[],
  }: {
    config: AttachmentsConfigInput;
    files?: File[];
  } = $props();

  function resolveConfig(): AttachmentsConfig | undefined {
    if (typeof config === "function") {
      return (config as () => AttachmentsConfig | undefined)();
    }
    return config;
  }

  // Getter wrapper keeps function configs live without capturing the initial
  // prop value (avoids svelte state_referenced_locally).
  const att = createAttachments({ config: resolveConfig });

  let lastConsumed = $state<unknown>(null);

  const snapshot = $derived(
    JSON.stringify({
      count: att.attachments.length,
      statuses: att.attachments.map((a) => a.status),
      filenames: att.attachments.map((a) => a.filename),
      enabled: att.enabled,
      dragOver: att.dragOver,
      hasContainer: att.containerRef !== null,
      hasFileInput: att.fileInputRef !== null,
    }),
  );

  async function handleProcess() {
    await att.processFiles(files);
  }

  function handleDragOverEvent(e: DragEvent) {
    att.handleDragOver(e);
  }

  function handleDropEvent(e: DragEvent) {
    void att.handleDrop(e);
  }
</script>

<div use:att.containerAction data-testid="scope">
  <span data-testid="inside">inside</span>
  <input use:att.fileInputAction data-testid="file-input" type="file" />
</div>
<span data-testid="outside">outside</span>
<button data-testid="process" onclick={handleProcess}>process</button>
<button
  data-testid="consume"
  onclick={() => {
    lastConsumed = att.consumeAttachments();
  }}
>
  consume
</button>
<button
  data-testid="remove-first"
  onclick={() => {
    const first = att.attachments[0];
    if (first) att.removeAttachment(first.id);
  }}
>
  remove
</button>
<button
  data-testid="dragover"
  onclick={(e) => {
    handleDragOverEvent(
      new DragEvent("dragover", { bubbles: true, cancelable: true }),
    );
    e.preventDefault();
  }}
>
  dragover
</button>
<button
  data-testid="drop-empty"
  onclick={(e) => {
    handleDropEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true }),
    );
    e.preventDefault();
  }}
>
  drop
</button>
<output data-testid="state">{snapshot}</output>
<output data-testid="consumed">{JSON.stringify(lastConsumed ?? null)}</output>
