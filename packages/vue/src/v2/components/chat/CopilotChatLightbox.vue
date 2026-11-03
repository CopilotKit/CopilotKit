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
import { ɵbindDialogFocus } from "@copilotkit/core";
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
let releaseFocus: (() => void) | undefined;

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}

onMounted(() => {
  if (typeof document === "undefined") return;
  document.addEventListener("keydown", handleKeydown);
  void nextTick(() => {
    if (!root.value) return;
    releaseFocus = ɵbindDialogFocus(root.value, {
      initialFocus: closeButton.value,
      returnFocusTo: props.returnFocusTo,
    });
  });
});

onBeforeUnmount(() => {
  if (typeof document === "undefined") return;
  document.removeEventListener("keydown", handleKeydown);
  releaseFocus?.();
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
