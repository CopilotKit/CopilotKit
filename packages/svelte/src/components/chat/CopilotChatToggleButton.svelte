<script lang="ts">
  let {
    isOpen = false,
    onclick,
  }: {
    isOpen?: boolean;
    onclick?: () => void;
  } = $props();
</script>

<button class="copilotkit-toggle-btn" {onclick}>
  {#if isOpen}
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 6L6 18M6 6l12 12"/>
    </svg>
  {:else}
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
    </svg>
  {/if}
</button>

<style>
  .copilotkit-toggle-btn {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: none;
    background: #3b82f6;
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    z-index: 100;
    transition: transform 0.2s;
  }

  .copilotkit-toggle-btn:hover {
    transform: scale(1.05);
    background: #2563eb;
  }
</style>
