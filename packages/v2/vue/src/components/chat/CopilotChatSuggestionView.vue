<script setup lang="ts">
import { computed, useAttrs } from "vue";
import type { Suggestion } from "@copilotkitnext/core";
import CopilotChatSuggestionPill from "./CopilotChatSuggestionPill.vue";

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
  suggestion?: (props: {
    suggestion: Suggestion;
    index: number;
    isLoading: boolean;
    onSelect: () => void;
  }) => unknown;
}>();

const emit = defineEmits<{
  "select-suggestion": [suggestion: Suggestion, index: number];
}>();

const attrs = useAttrs();
const loadingSet = computed(() => new Set(props.loadingIndexes));
const containerClass = computed(() => [
  "flex flex-wrap items-center gap-1.5 pl-0 pr-4 pointer-events-none sm:gap-2 sm:px-0",
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
</script>

<template>
  <div
    data-testid="copilot-chat-suggestion-view"
    :class="containerClass"
    v-bind="containerAttrs"
  >
    <template v-for="(suggestion, index) in suggestions" :key="`${suggestion.title}-${index}`">
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
</template>
