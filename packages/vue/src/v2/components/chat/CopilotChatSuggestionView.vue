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
    /**
     * `"pills"` (default): compact chips in a single scrollable row.
     * `"cards"`: a grid of cards, each with the suggestion's title as header
     * and its message as body. Welcome screens use cards.
     */
    appearance?: "pills" | "cards";
  }>(),
  {
    loadingIndexes: () => [],
    appearance: "pills",
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
// Pills: a single scrollable row whose right edge fades when pills overflow.
const rowClass = [
  "cpk:flex cpk:flex-nowrap cpk:items-center cpk:gap-2 cpk:overflow-x-auto cpk:py-1",
  "cpk:[scrollbar-width:none] cpk:[&::-webkit-scrollbar]:hidden",
  "cpk:[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]",
].join(" ");
// Cards: two columns at every width, so cards stay close to square in narrow
// chats (popup, sidebar) too. `auto-rows-fr` gives every card the same height.
const gridClass =
  "cpk:grid cpk:w-full cpk:auto-rows-fr cpk:grid-cols-2 cpk:gap-2";

const containerClass = computed(() => [
  props.appearance === "cards" ? gridClass : rowClass,
  "cpk:pointer-events-auto",
  attrs.class,
]);
const containerAttrs = computed(() => {
  const { class: _className, ...rest } = attrs;
  return { ...rest, "data-appearance": props.appearance };
});

/** Cards show the suggestion's message under its title (unless they match). */
function descriptionFor(suggestion: Suggestion): string | undefined {
  if (props.appearance !== "cards") return undefined;
  return suggestion.message && suggestion.message !== suggestion.title
    ? suggestion.message
    : undefined;
}

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
            :appearance="appearance === 'cards' ? 'card' : 'pill'"
            :description="descriptionFor(suggestion)"
            :on-select="() => handleSelectSuggestion(suggestion, index)"
          >
            <CopilotChatSuggestionPill
              :is-loading="isLoading(index, suggestion)"
              :appearance="appearance === 'cards' ? 'card' : 'pill'"
              :description="descriptionFor(suggestion)"
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
