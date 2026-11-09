<script setup lang="ts">
import { ref } from "vue";
import type { GenerativeUIInvokeResult } from "@copilotkit/vue/v2/generative-ui";

// The props come from `storeUI` in ./catalog.ts. A component cannot take
// its types from the UI that lists it (a circular type), so they are
// written out here. `inCart` is bound to the cart state, and
// `onAddToCart` calls the page's `addToCart` function.
const props = defineProps<{
  productId: string;
  name: string;
  price: number;
  tagline?: string;
  inCart: number;
  onAddToCart?: (args: {
    productId: string;
  }) => Promise<GenerativeUIInvokeResult>;
}>();

const status = ref<"idle" | "pending" | "added" | "error">("idle");
const error = ref<string>();

const labels = {
  idle: "Add to cart",
  pending: "Adding...",
  added: "Added",
  error: "Add to cart",
};

async function add() {
  if (!props.onAddToCart) return;
  status.value = "pending";
  const result = await props.onAddToCart({ productId: props.productId });
  if (result.ok) {
    status.value = "added";
    return;
  }
  status.value = "error";
  error.value = result.error.message;
}
</script>

<template>
  <article class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
    <div class="font-medium">{{ name }}</div>
    <div v-if="tagline" class="text-xs text-gray-500">{{ tagline }}</div>
    <div class="mt-2 flex items-center justify-between">
      <span class="font-semibold">${{ price }}</span>
      <button
        type="button"
        :disabled="!onAddToCart || status === 'pending'"
        class="rounded bg-black px-2 py-1 text-xs text-white disabled:opacity-40"
        @click="add"
      >
        {{ labels[status] }}
      </button>
    </div>
    <div v-if="inCart > 0" class="mt-1 text-xs text-gray-600">
      In cart: {{ inCart }}
    </div>
    <div
      v-if="status === 'error'"
      role="alert"
      class="mt-1 text-xs text-red-600"
    >
      {{ error }}
    </div>
  </article>
</template>
