import type { NextConfig } from "next";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function localBackendsEnv(): string {
  if (process.env.SHOWCASE_LOCAL !== "1") return "";
  const portsPath = path.resolve(__dirname, "..", "shared", "local-ports.json");
  if (!fs.existsSync(portsPath)) return "";
  // This runs at build time, so failing the build IS the loud path —
  // name the offending file instead of surfacing a bare SyntaxError.
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(portsPath, "utf-8"));
  } catch (err) {
    throw new Error(`${portsPath} is not valid JSON: ${String(err)}`, {
      cause: err,
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `${portsPath} must be a JSON object mapping slug -> port (got ` +
        `${Array.isArray(parsed) ? "an array" : typeof parsed}).`,
    );
  }
  const map: Record<string, string> = {};
  for (const [slug, port] of Object.entries(parsed)) {
    if (typeof port !== "number" || !Number.isFinite(port)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[next.config] ${portsPath}: port for "${slug}" is not a number — skipping it.`,
      );
      continue;
    }
    map[slug] = `http://localhost:${port}`;
  }
  return JSON.stringify(map);
}

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
    NEXT_PUBLIC_LOCAL_BACKENDS: localBackendsEnv(),
  },
  serverExternalPackages: ["@copilotkit/runtime", "@copilotkitnext/runtime"],
};

export default nextConfig;
