// @region[nuxt-configuration]
import { defineNuxtConfig } from "nuxt/config";
import type { NuxtConfig } from "nuxt/schema";

const config: NuxtConfig = defineNuxtConfig({
  css: ["@copilotkit/vue/styles.css"],
  devtools: { enabled: true },
});

export default config;
// @endregion[nuxt-configuration]
