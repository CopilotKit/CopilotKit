import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";
// Logic lives in src/lib so vitest can cover it (missing-file warning,
// TCP-port validation) — see src/lib/local-backends-env.test.ts.
import { localBackendsEnv } from "./src/lib/local-backends-env";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LOCAL_PORTS_PATH = path.resolve(
  __dirname,
  "..",
  "shared",
  "local-ports.json",
);

// NOTE: the docs-host 308s (/docs, /ag-ui, /reference and the
// /<framework-slug> routes) intentionally do NOT live here. A
// next.config `redirects()` table is baked into the build artifact, so
// the destination host would freeze to whatever was current at Docker
// build (staging shells 301'd to the PROD docs host). They are issued
// by src/middleware.ts instead, resolving the docs host from runtime
// config (DOCS_HOST env var) on every request — see
// src/lib/docs-redirects.ts.

const nextConfig: NextConfig = {
  env: {
    // NEXT_PUBLIC_BASE_URL intentionally NOT listed here: it must be
    // read at request time via runtime-config (otherwise `next build`
    // re-bakes the build-time value into every chunk). NEXT_PUBLIC_LOCAL_BACKENDS
    // is fine to bake because it is computed from `shared/local-ports.json`
    // (a JSON file on disk, not an env var) and only used in local-dev.
    NEXT_PUBLIC_LOCAL_BACKENDS: localBackendsEnv(LOCAL_PORTS_PATH),
  },
  serverExternalPackages: ["@copilotkit/runtime"],
};

export default nextConfig;
