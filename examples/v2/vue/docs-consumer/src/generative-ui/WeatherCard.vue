<!-- @region[display-only-weather-card] -->
<script setup lang="ts">
defineProps<{
  city: string;
  temperature: number;
  condition: string;
}>();
</script>

<template>
  <article class="weather-card">
    <h3>{{ city }}</h3>
    <p>{{ temperature }}°F</p>
    <p>{{ condition }}</p>
  </article>
</template>
<!-- @endregion[display-only-weather-card] -->
