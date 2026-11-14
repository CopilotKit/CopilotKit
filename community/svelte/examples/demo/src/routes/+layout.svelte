<script lang="ts">
  import "@copilotkit/svelte/styles.css";
  import "../app.css";
  let { children } = $props();
</script>

{@render children()}
