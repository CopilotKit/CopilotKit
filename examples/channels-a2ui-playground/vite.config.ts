import { defineConfig } from "vite";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.CONDUCTOR_PORT ?? 5173),
    strictPort: true,
  },
});
