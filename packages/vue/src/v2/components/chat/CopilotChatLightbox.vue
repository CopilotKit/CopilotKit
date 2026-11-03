<script setup lang="ts">
/**
 * A full-screen preview, teleported to `document.body`, as React's
 * `<Lightbox>`. It closes on Escape, a click on the backdrop, or its close
 * button, which is named by `labels.attachmentPreviewCloseButtonLabel`.
 *
 * Beyond React, it is a modal dialog for assistive technology: focus moves to
 * the close button when it opens, Tab stays inside it, and focus returns to
 * the element that opened it (or `returnFocusTo`) when it closes.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { IconX } from "../icons";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";

const props = defineProps<{
  /** Accessible name of the dialog, for example the file name. */
  label?: string;
  /** Where focus goes on close. Defaults to the element focused on open. */
  returnFocusTo?: HTMLElement | null;
}>();

const emit = defineEmits<{ close: [] }>();

defineSlots<{ default(): unknown }>();

const config = useCopilotChatConfiguration();
const labels = computed(() => config.value?.labels ?? CopilotChatDefaultLabels);

const root = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), audio[controls], video[controls], iframe, [tabindex]:not([tabindex="-1"])';

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}

/** Keeps Tab inside the lightbox while it is open. */
function handleTab(event: KeyboardEvent) {
  if (event.key !== "Tab" || !root.value) return;
  const focusables = Array.from(
    root.value.querySelectorAll<HTMLElement>(FOCUSABLE),
  );
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.value.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  if (typeof document === "undefined") return;
  previouslyFocused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  document.addEventListener("keydown", handleKeydown);
  void nextTick(() => closeButton.value?.focus());
});

onBeforeUnmount(() => {
  if (typeof document === "undefined") return;
  document.removeEventListener("keydown", handleKeydown);
  const target = props.returnFocusTo ?? previouslyFocused;
  if (target?.isConnected) target.focus();
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="root"
      class="cpk-attachment-lightbox"
      role="dialog"
      aria-modal="true"
      :aria-label="label"
      data-testid="copilot-chat-attachment-lightbox"
      @click="emit('close')"
      @keydown="handleTab"
    >
      <button
        ref="closeButton"
        type="button"
        class="cpk-attachment-lightbox-close-button"
        :aria-label="labels.attachmentPreviewCloseButtonLabel"
        @click.stop="emit('close')"
      >
        <IconX class="cpk-attachment-lightbox-close-icon" aria-hidden="true" />
      </button>

      <div data-testid="copilot-chat-attachment-lightbox-content" @click.stop>
        <slot />
      </div>
    </div>
  </Teleport>
</template>
