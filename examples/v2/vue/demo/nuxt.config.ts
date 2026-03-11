export default defineNuxtConfig({
  devtools: { enabled: false },
  css: ["@copilotkitnext/vue/styles.css", "~/assets/css/main.css"],
  vite: {
    ssr: {
      noExternal: ["@copilotkitnext/vue", "@ag-ui/client", "fast-json-patch"],
    },
  },
  postcss: {
    plugins: {
      "@tailwindcss/postcss": {},
    },
  },
  typescript: {
    strict: true,
  },
});
