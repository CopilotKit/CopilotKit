import type { NextConfig } from "next";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function localBackendsEnv(): string {
  if (process.env.SHOWCASE_LOCAL !== "1") return "";
  const portsPath = path.resolve(__dirname, "..", "shared", "local-ports.json");
  if (!fs.existsSync(portsPath)) return "";
  const ports = JSON.parse(fs.readFileSync(portsPath, "utf-8")) as Record<
    string,
    number
  >;
  const map: Record<string, string> = {};
  for (const [slug, port] of Object.entries(ports)) {
    map[slug] = `http://localhost:${port}`;
  }
  return JSON.stringify(map);
}

// Read registry to get the list of framework slugs owned by the docs
// shell. Any path whose first segment is a framework slug must 301 to
// docs.showcase.copilotkit.ai. This list is derived at build time so
// the redirect table tracks registry changes automatically — no manual
// sync between next.config.ts and the docs shell's ownership list.
function frameworkSlugs(): string[] {
  const registryPath = path.resolve(__dirname, "src", "data", "registry.json");
  if (!fs.existsSync(registryPath)) return [];
  try {
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as {
      integrations?: { slug: string }[];
    };
    return (registry.integrations ?? []).map((i) => i.slug);
  } catch {
    return [];
  }
}

const DOCS_HOST = "https://docs.showcase.copilotkit.ai";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BASE_URL:
      process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000",
    NEXT_PUBLIC_LOCAL_BACKENDS: localBackendsEnv(),
  },
  serverExternalPackages: ["@copilotkit/runtime", "@copilotkitnext/runtime"],
  async redirects() {
    const slugs = frameworkSlugs();
    // Fixed docs-route redirects — whole sections (docs, ag-ui, reference)
    // now live on docs.showcase.copilotkit.ai. Use 301 (permanent) so
    // search engines carry authority over to the new host.
    const fixed = [
      {
        source: "/docs",
        destination: `${DOCS_HOST}`,
        permanent: true,
      },
      {
        source: "/docs/:path*",
        destination: `${DOCS_HOST}/:path*`,
        permanent: true,
      },
      {
        source: "/ag-ui",
        destination: `${DOCS_HOST}/ag-ui`,
        permanent: true,
      },
      {
        source: "/ag-ui/:path*",
        destination: `${DOCS_HOST}/ag-ui/:path*`,
        permanent: true,
      },
      {
        source: "/reference",
        destination: `${DOCS_HOST}/reference`,
        permanent: true,
      },
      {
        source: "/reference/:path*",
        destination: `${DOCS_HOST}/reference/:path*`,
        permanent: true,
      },
    ];
    // Framework-scoped routes — /<slug> and /<slug>/... both go to the
    // docs host. Enumerated from registry rather than a `:slug*` wildcard
    // so we DON'T blanket-redirect /integrations or /matrix (which are
    // owned by shell).
    const frameworkRedirects = slugs.flatMap((slug) => [
      {
        source: `/${slug}`,
        destination: `${DOCS_HOST}/${slug}`,
        permanent: true,
      },
      {
        source: `/${slug}/:path*`,
        destination: `${DOCS_HOST}/${slug}/:path*`,
        permanent: true,
      },
    ]);
    return [...fixed, ...frameworkRedirects];
  },
};

export default nextConfig;
