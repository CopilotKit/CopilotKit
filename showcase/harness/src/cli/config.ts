import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_DIR = path.resolve(__dirname, "../../..");

export interface LocalConfig {
  showcaseDir: string;
  composeFile: string;
  localPorts: Record<string, number>;
  pocketbase: {
    url: string;
    email: string;
    password: string;
  };
  aimockUrl: string;
  dashboardUrl: string;
  dashboardPort: number;
}

export function loadConfig(): LocalConfig {
  // Honor LOCAL_PORTS_FILE env var (set by isolation overlay) so the harness
  // reads offset ports from a temp file instead of the checked-in original.
  const portsFile =
    process.env.LOCAL_PORTS_FILE ||
    path.join(SHOWCASE_DIR, "shared/local-ports.json");
  const localPorts = JSON.parse(fs.readFileSync(portsFile, "utf-8")) as Record<
    string,
    number
  >;

  return {
    showcaseDir: SHOWCASE_DIR,
    composeFile: path.join(SHOWCASE_DIR, "docker-compose.local.yml"),
    localPorts,
    pocketbase: {
      url: "http://localhost:8090",
      // PB 0.22+ rejects `admin@localhost` (single-label TLD) as an invalid
      // email. Use a valid format that the PB validator accepts. The
      // matching admin account is created in the entrypoint / migrations
      // path; the docker-compose env vars and `bin/showcase` superuser
      // bootstrap must agree on this value.
      email: "admin@localhost.dev",
      password: "showcase-local-dev",
    },
    aimockUrl: "http://localhost:4010",
    dashboardUrl: "http://localhost:3200",
    dashboardPort: 3200,
  };
}

export function getPackageUrl(slug: string, config: LocalConfig): string {
  const port = config.localPorts[slug];
  if (!port) {
    throw new Error(
      `No local port mapping for slug "${slug}". Check shared/local-ports.json.`,
    );
  }
  return `http://localhost:${port}`;
}
