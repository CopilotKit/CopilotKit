<script setup lang="ts">
// The live cart. Both props are bound to the cart state, so the agent
// renders the component and the app keeps the numbers current.
defineProps<{ count: number; total: number }>();
</script>

<template>
  <div class="rounded-lg bg-gray-50 p-3 text-sm">
    Cart: <strong>{{ count }}</strong> item(s), <strong>${{ total }}</strong>
  </div>
</template>
