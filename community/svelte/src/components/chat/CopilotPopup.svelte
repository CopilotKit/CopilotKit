<script lang="ts">
  import { tick } from "svelte";
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

  let popupRef: HTMLElement | undefined;
  let wrapperRef: HTMLElement | undefined;

  function toggle() {
    if (isOpen) {
      close();
    } else {
      isOpen = true;
    }
  }

  function close() {
    wrapperRef?.querySelector<HTMLButtonElement>(".copilotkit-toggle-btn")?.focus();
    isOpen = false;
  }

  function trapFocus(event: KeyboardEvent) {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key !== "Tab" || !popupRef) return;
    const focusable = [...popupRef.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.hasAttribute("hidden"));
    if (focusable.length === 0) {
      event.preventDefault();
      popupRef.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (!popupRef.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  $effect(() => {
    if (!isOpen) return;
    void tick().then(() => {
      const firstFocusable = popupRef?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      (firstFocusable ?? popupRef)?.focus();
    });
  });

  function handleOverlayClick(e: MouseEvent) {
    if (clickOutsideToClose && e.target === e.currentTarget) {
      close();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (isOpen && e.key === "Escape") close();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="copilotkit-popup-wrapper" bind:this={wrapperRef}>
  <CopilotChatToggleButton isOpen={isOpen} onclick={toggle} />

  <div
    class="copilotkit-popup-overlay"
    class:is-closed={!isOpen}
    role="presentation"
    aria-hidden={isOpen ? undefined : true}
    inert={!isOpen}
    hidden={!isOpen}
    onclick={handleOverlayClick}
    onkeydown={(e) => e.key === "Escape" && close()}
  >
    <div
      class="copilotkit-popup"
      style="width: {popupWidth}; height: {popupHeight}"
      role="dialog"
      aria-modal="true"
      aria-labelledby="copilot-popup-title"
      tabindex="-1"
      bind:this={popupRef}
      onkeydown={trapFocus}
    >
      <div class="copilotkit-popup-header">
        <h3 id="copilot-popup-title" class="copilotkit-popup-title">Copilot</h3>
        <button class="copilotkit-popup-close" aria-label="Close chat" onclick={close}>✕</button>
      </div>
      <div class="copilotkit-popup-body">
        <CopilotChat {...chatProps} />
      </div>
    </div>
  </div>
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

  .copilotkit-popup-overlay.is-closed,
  .copilotkit-popup-overlay[hidden] {
    display: none !important;
    visibility: hidden;
    pointer-events: none;
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
