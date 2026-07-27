<!-- @region[programmatic-tool-rendering] -->
<script setup lang="ts">
import { h } from "vue";
import { z } from "zod";
import { useRenderTool } from "@copilotkit/vue/v2";

const weatherParameters = z.object({
  city: z.string(),
  temperature: z.number().optional(),
});

interface WeatherRenderProps {
  parameters: Partial<z.infer<typeof weatherParameters>>;
  status: "inProgress" | "executing" | "complete";
  result: string | undefined;
}

useRenderTool({
  name: "getWeather",
  parameters: weatherParameters,
  render: ({ parameters, status, result }: WeatherRenderProps) =>
    h("article", [
      h("strong", parameters.city ?? "Loading city…"),
      h("p", status === "complete" ? result : "Checking the forecast…"),
    ]),
});
</script>

<template>
  <div />
</template>
<!-- @endregion[programmatic-tool-rendering] -->
