<script setup lang="ts">
import { componentForFeature } from "./feature-map";
import type { VueHostConfiguration } from "./host-configuration";

const props = defineProps<{
  configuration: VueHostConfiguration;
}>();

const featureComponent = componentForFeature(props.configuration.feature);
</script>

<template>
  <component :is="featureComponent" :configuration="configuration" />
</template>
