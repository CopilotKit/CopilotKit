<script lang="ts">
  import { tick } from "svelte";
  import CopilotChat from "./CopilotChat.svelte";
  import CopilotChatToggleButton from "./CopilotChatToggleButton.svelte";
  import type { CopilotSidebarProps } from "./types";

  let {
    width = "400px",
    defaultOpen = false,
    ...chatProps
  }: CopilotSidebarProps = $props();

  // svelte-ignore state_referenced_locally
  let isOpen = $state(defaultOpen);
  let sidebarWidth = $derived(typeof width === "number" ? `${width}px` : width);
  let wrapperRef: HTMLElement | undefined;
  let sidebarRef: HTMLElement | undefined;

  function toggle() {
    isOpen = !isOpen;
  }

  function close() {
    const restoreFocus = !!sidebarRef?.contains(document.activeElement);
    isOpen = false;
    if (restoreFocus) {
      void tick().then(() => {
        wrapperRef?.querySelector<HTMLButtonElement>(".copilotkit-toggle-btn")?.focus();
      });
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (isOpen && e.key === "Escape") close();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="copilotkit-sidebar-wrapper" bind:this={wrapperRef}>
  <CopilotChatToggleButton isOpen={isOpen} onclick={toggle} />

  <div
    class="copilotkit-sidebar-overlay"
    class:is-closed={!isOpen}
    role="presentation"
    aria-hidden={isOpen ? undefined : true}
    inert={!isOpen}
    hidden={!isOpen}
    onclick={close}
    onkeydown={(e) => e.key === "Escape" && close()}
  ></div>
  <div
    class="copilotkit-sidebar"
    class:is-closed={!isOpen}
    style="width: {sidebarWidth}"
    aria-hidden={isOpen ? undefined : true}
    inert={!isOpen}
    hidden={!isOpen}
    bind:this={sidebarRef}
  >
    <div class="copilotkit-sidebar-header">
      <h3 class="copilotkit-sidebar-title">Copilot</h3>
      <button class="copilotkit-sidebar-close" aria-label="Close chat" onclick={close}>✕</button>
    </div>
    <div class="copilotkit-sidebar-body">
      <CopilotChat {...chatProps} />
    </div>
  </div>
</div>

<style>
  .copilotkit-sidebar-wrapper {
    position: relative;
  }

  .copilotkit-sidebar-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 99;
  }

  .copilotkit-sidebar-overlay.is-closed,
  .copilotkit-sidebar-overlay[hidden],
  .copilotkit-sidebar.is-closed,
  .copilotkit-sidebar[hidden] {
    display: none !important;
    visibility: hidden;
    pointer-events: none;
  }

  .copilotkit-sidebar {
    position: fixed;
    top: 0;
    right: 0;
    height: 100%;
    background: #fff;
    box-shadow: -4px 0 12px rgba(0, 0, 0, 0.1);
    z-index: 100;
    display: flex;
    flex-direction: column;
    max-width: 100vw;
  }

  .copilotkit-sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    border-bottom: 1px solid #e5e7eb;
  }

  .copilotkit-sidebar-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .copilotkit-sidebar-close {
    border: none;
    background: none;
    font-size: 20px;
    cursor: pointer;
    color: #6b7280;
    padding: 4px;
    border-radius: 4px;
  }

  .copilotkit-sidebar-close:hover {
    background: #f3f4f6;
  }

  .copilotkit-sidebar-body {
    flex: 1;
    overflow: hidden;
  }
</style>
