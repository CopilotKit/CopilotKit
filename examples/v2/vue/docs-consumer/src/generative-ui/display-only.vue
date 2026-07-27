<!-- @region[display-only-component-registration] -->
<script setup lang="ts">
import { useComponent } from "@copilotkit/vue/v2";
import { z } from "zod";
import GreetingCard from "./GreetingCard.vue";
import WeatherCard from "./WeatherCard.vue";

const weatherSchema = z.object({
  city: z.string().describe("City name"),
  temperature: z.number().describe("Temperature in Fahrenheit"),
  condition: z.string().describe("Weather condition"),
});

useComponent({
  name: "showWeather",
  description: "Display a weather card for a city.",
  parameters: weatherSchema,
  render: WeatherCard,
  agentId: "default",
});

useComponent({
  name: "showGreeting",
  description: "Display a friendly greeting.",
  render: GreetingCard,
});
</script>

<template>
  <main>
    <p>Ask the agent to show the weather or a greeting.</p>
  </main>
</template>
<!-- @endregion[display-only-component-registration] -->
