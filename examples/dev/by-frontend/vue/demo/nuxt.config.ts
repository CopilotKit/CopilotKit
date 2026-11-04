export default defineNuxtConfig({
  devtools: { enabled: false },
  css: ["~/assets/css/main.css"],
  vite: {
    ssr: {
      noExternal: ["@copilotkit/vue", "@ag-ui/client", "fast-json-patch"],
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
