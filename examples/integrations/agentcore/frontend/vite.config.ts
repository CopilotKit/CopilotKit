// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  define: {
    "import.meta.env.VITE_COPILOTKIT_THREADS_ENABLED": JSON.stringify(
      process.env.VITE_COPILOTKIT_THREADS_ENABLED ??
        (process.env.COPILOTKIT_LICENSE_TOKEN ? "true" : "false"),
    ),
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  build: {
    outDir: "build",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "ui-vendor": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-select",
            "@radix-ui/react-alert-dialog",
            "@radix-ui/react-progress",
          ],
          "auth-vendor": ["react-oidc-context", "aws-amplify"],
        },
      },
    },
  },

  server: {
    port: 3000,
    open: true,
  },
});
