<script lang="ts">
  import SvelteMarkdown from "@humanspeak/svelte-markdown";

  let {
    content = "",
  }: {
    content?: string;
  } = $props();
</script>

<SvelteMarkdown source={content} streaming={true} />
