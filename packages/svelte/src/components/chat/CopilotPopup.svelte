<script lang="ts">
  import CopilotChat from "./CopilotChat.svelte";
  import CopilotChatToggleButton from "./CopilotChatToggleButton.svelte";
  import type { CopilotPopupProps } from "./types";

  let {
    width = "400px",
    height = "600px",
    clickOutsideToClose = true,
    defaultOpen = false,
    ...chatProps
  }: CopilotPopupProps = $props();

  // svelte-ignore state_referenced_locally
  let isOpen = $state(defaultOpen);
  let popupWidth = $derived(typeof width === "number" ? `${width}px` : width);
  let popupHeight = $derived(typeof height === "number" ? `${height}px` : height);

  let popupRef: HTMLElement | undefined = $state();

  function toggle() {
    isOpen = !isOpen;
  }

  function open() {
    isOpen = true;
  }

  function close() {
    isOpen = false;
  }

  function handleOverlayClick(e: MouseEvent) {
    if (clickOutsideToClose && e.target === e.currentTarget) {
      close();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="copilotkit-popup-wrapper">
  <CopilotChatToggleButton isOpen={isOpen} onclick={toggle} />

  {#if isOpen}
    <div class="copilotkit-popup-overlay" role="presentation" onclick={handleOverlayClick} onkeydown={(e) => e.key === 'Escape' && close()}>
      <div
        class="copilotkit-popup"
        style="width: {popupWidth}; height: {popupHeight}"
        bind:this={popupRef}
      >
        <div class="copilotkit-popup-header">
          <h3 class="copilotkit-popup-title">Copilot</h3>
          <button class="copilotkit-popup-close" onclick={close}>✕</button>
        </div>
        <div class="copilotkit-popup-body">
          <CopilotChat {...chatProps} />
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .copilotkit-popup-wrapper {
    position: relative;
  }

  .copilotkit-popup-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 99;
    padding: 16px;
  }

  .copilotkit-popup {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    max-height: 90vh;
    max-width: 100vw;
  }

  .copilotkit-popup-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    border-bottom: 1px solid #e5e7eb;
  }

  .copilotkit-popup-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .copilotkit-popup-close {
    border: none;
    background: none;
    font-size: 18px;
    cursor: pointer;
    color: #6b7280;
    padding: 4px;
    border-radius: 4px;
  }

  .copilotkit-popup-close:hover {
    background: #f3f4f6;
  }

  .copilotkit-popup-body {
    flex: 1;
    overflow: hidden;
  }
</style>
