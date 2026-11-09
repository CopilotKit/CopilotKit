<script setup lang="ts">
import { ref } from "vue";
import type { GenerativeUIInvokeResult } from "@copilotkit/vue/v2/generative-ui";
import { COUPON_CODE } from "./cart";

// `email` and `note` are writable: the agent can prefill them, and what the
// user types wins over later agent updates. `onApplyCoupon` calls the page's
// `applyCoupon` function, and `onSubmit` goes to the agent as an event.
const props = defineProps<{
  onApplyCoupon?: (args: {
    code: string;
  }) => Promise<GenerativeUIInvokeResult>;
  onSubmit?: (args: {
    email: string;
    note: string;
  }) => Promise<GenerativeUIInvokeResult>;
}>();
const email = defineModel<string>("email");
const note = defineModel<string>("note");

const code = ref("");
const message = ref<string>();

async function submit() {
  if (!props.onSubmit) return;
  const result = await props.onSubmit({
    email: email.value ?? "",
    note: note.value ?? "",
  });
  if (!result.ok) message.value = result.error.message;
}

async function applyCoupon() {
  if (!props.onApplyCoupon) return;
  const result = await props.onApplyCoupon({ code: code.value });
  message.value = result.ok ? "Coupon applied" : result.error.message;
}
</script>

<template>
  <form
    class="space-y-2 rounded-lg border border-gray-200 bg-white p-3 text-sm"
    @submit.prevent="submit"
  >
    <label class="block">
      Email
      <input
        v-model="email"
        type="email"
        class="mt-1 w-full rounded border px-2 py-1"
      />
    </label>
    <label class="block">
      Note
      <textarea v-model="note" class="mt-1 w-full rounded border px-2 py-1" />
    </label>
    <div class="flex gap-2">
      <input
        v-model="code"
        aria-label="Coupon code"
        placeholder="Coupon"
        class="flex-1 rounded border px-2 py-1"
      />
      <button
        type="button"
        class="rounded border px-2"
        :disabled="!onApplyCoupon"
        @click="applyCoupon"
      >
        Apply
      </button>
    </div>
    <div class="text-xs text-gray-500">
      Demo coupon: <code>{{ COUPON_CODE }}</code> (10% off)
    </div>
    <button
      type="submit"
      :disabled="!onSubmit"
      class="rounded bg-black px-3 py-1 text-white disabled:opacity-40"
    >
      Place order
    </button>
    <div v-if="message" role="status" class="text-xs text-gray-600">
      {{ message }}
    </div>
  </form>
</template>
