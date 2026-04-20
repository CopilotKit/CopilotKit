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

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BASE_URL:
      process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000",
    NEXT_PUBLIC_LOCAL_BACKENDS: localBackendsEnv(),
  },
  serverExternalPackages: ["@copilotkit/runtime", "@copilotkitnext/runtime"],
};

export default nextConfig;
