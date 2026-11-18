import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith("cpk-"),
        },
      },
    }),
  ],
  define: {
    "process.env.NODE_ENV": JSON.stringify("development"),
  },
  optimizeDeps: {
    include: ["@copilotkit/web-inspector"],
  },
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
  },
});
