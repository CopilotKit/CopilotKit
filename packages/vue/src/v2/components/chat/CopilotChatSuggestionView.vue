<script setup lang="ts">
import { computed, useAttrs } from "vue";
import type { Suggestion } from "@copilotkit/core";
import CopilotChatSuggestionPill from "./CopilotChatSuggestionPill.vue";
import type {
  CopilotChatSuggestionViewContainerSlotProps,
  CopilotChatSuggestionViewLayoutSlotProps,
  CopilotChatSuggestionViewSuggestionSlotProps,
} from "./types";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    suggestions: Suggestion[];
    loadingIndexes?: ReadonlyArray<number>;
  }>(),
  {
    loadingIndexes: () => [],
  },
);

defineSlots<{
  suggestion?: (props: CopilotChatSuggestionViewSuggestionSlotProps) => unknown;
  container?: (props: CopilotChatSuggestionViewContainerSlotProps) => unknown;
  layout?: (props: CopilotChatSuggestionViewLayoutSlotProps) => unknown;
}>();

const emit = defineEmits<{
  "select-suggestion": [suggestion: Suggestion, index: number];
}>();

const attrs = useAttrs();
const loadingSet = computed(() => new Set(props.loadingIndexes));
const containerClass = computed(() => [
  "cpk:flex cpk:flex-wrap cpk:items-center cpk:gap-1.5 cpk:pl-0 cpk:pr-4 cpk:pointer-events-none cpk:sm:gap-2 cpk:sm:px-0",
  attrs.class,
]);
const containerAttrs = computed(() => {
  const { class: _className, ...rest } = attrs;
  return rest;
});

function isLoading(index: number, suggestion: Suggestion) {
  return loadingSet.value.has(index) || suggestion.isLoading === true;
}

function handleSelectSuggestion(suggestion: Suggestion, index: number) {
  emit("select-suggestion", suggestion, index);
}

const slotProps = computed<CopilotChatSuggestionViewContainerSlotProps>(() => ({
  suggestions: props.suggestions,
  loadingIndexes: props.loadingIndexes,
  onSelectSuggestion: handleSelectSuggestion,
  containerClass: containerClass.value,
  containerAttrs: containerAttrs.value as Record<string, unknown>,
}));
</script>

<template>
  <slot name="layout" v-bind="slotProps">
    <slot name="container" v-bind="slotProps">
      <div
        data-copilotkit
        data-testid="copilot-chat-suggestion-view"
        :class="containerClass"
        v-bind="containerAttrs"
      >
        <template
          v-for="(suggestion, index) in suggestions"
          :key="`${suggestion.title}-${index}`"
        >
          <slot
            name="suggestion"
            :suggestion="suggestion"
            :index="index"
            :is-loading="isLoading(index, suggestion)"
            :on-select="() => handleSelectSuggestion(suggestion, index)"
          >
            <CopilotChatSuggestionPill
              :is-loading="isLoading(index, suggestion)"
              type="button"
              @click="handleSelectSuggestion(suggestion, index)"
            >
              {{ suggestion.title }}
            </CopilotChatSuggestionPill>
          </slot>
        </template>
      </div>
    </slot>
  </slot>
</template>
