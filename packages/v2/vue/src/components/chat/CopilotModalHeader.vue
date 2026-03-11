<script setup lang="ts">
import { computed, useAttrs } from "vue";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";
import CopilotModalHeaderCloseButton from "./CopilotModalHeaderCloseButton";
import CopilotModalHeaderTitle from "./CopilotModalHeaderTitle";
import type {
  CopilotModalHeaderCloseButtonSlotProps,
  CopilotModalHeaderLayoutSlotProps,
  CopilotModalHeaderProps,
  CopilotModalHeaderTitleContentSlotProps,
} from "./types";

defineOptions({ inheritAttrs: false });

const props = defineProps<CopilotModalHeaderProps>();

defineSlots<{
  "title-content"?: (props: CopilotModalHeaderTitleContentSlotProps) => unknown;
  "close-button"?: (props: CopilotModalHeaderCloseButtonSlotProps) => unknown;
  layout?: (props: CopilotModalHeaderLayoutSlotProps) => unknown;
}>();

const attrs = useAttrs();
const config = useCopilotChatConfiguration();

const resolvedTitle = computed(
  () => props.title ?? config.value?.labels.modalHeaderTitle ?? CopilotChatDefaultLabels.modalHeaderTitle,
);
const headerClass = computed(() => [
  "flex items-center justify-between border-b border-border px-4 py-4",
  "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
  attrs.class,
]);
const headerAttrs = computed(() => {
  const { class: _className, ...rest } = attrs;
  return rest;
});

function handleClose() {
  config.value?.setModalOpen?.(false);
}
</script>

<template>
  <header
    data-slot="copilot-modal-header"
    :class="headerClass"
    v-bind="headerAttrs"
  >
    <slot name="layout" :title="resolvedTitle" :on-close="handleClose">
      <div class="flex w-full items-center gap-2">
        <div class="flex flex-1" aria-hidden="true" />
        <div class="flex flex-1 justify-center text-center">
          <slot name="title-content" :title="resolvedTitle">
            <CopilotModalHeaderTitle>
              {{ resolvedTitle }}
            </CopilotModalHeaderTitle>
          </slot>
        </div>
        <div class="flex flex-1 justify-end">
          <slot name="close-button" :on-close="handleClose">
            <CopilotModalHeaderCloseButton @click="handleClose" />
          </slot>
        </div>
      </div>
    </slot>
  </header>
</template>
