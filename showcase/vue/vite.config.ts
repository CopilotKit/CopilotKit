import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/vue/",
  plugins: [vue()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
