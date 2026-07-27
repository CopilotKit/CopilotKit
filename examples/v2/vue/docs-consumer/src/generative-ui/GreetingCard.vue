<!-- @region[display-only-greeting-card] -->
<script setup lang="ts">
defineProps<{
  message: string;
}>();
</script>

<template>
  <aside class="greeting-card">{{ message }}</aside>
</template>
<!-- @endregion[display-only-greeting-card] -->
