import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The CopilotKit runtime pulls in optional server deps (e.g. graphql-yoga,
  // pino) that Next's bundler should treat as external on the server.
  serverExternalPackages: ["@copilotkit/runtime"],
  // This app lives in a subdirectory that has its own lockfile; pin the file
  // tracing root here so Next doesn't walk up to the parent RN app's lockfile.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
