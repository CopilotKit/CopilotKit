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
    composeFile:
      process.env.SHOWCASE_COMPOSE_FILE ||
      path.join(SHOWCASE_DIR, "docker-compose.local.yml"),
    localPorts,
    pocketbase: {
      url: process.env.POCKETBASE_URL_LOCAL || "http://localhost:8090",
      // The host CLI loads no env file (showcase/.env is passed to containers
      // via compose `env_file`, never into the host process), so an isolated
      // `bin/showcase` run falls through to this default. It MUST equal the
      // superuser the PB `entrypoint.sh` actually seeds — i.e. the value of
      // POCKETBASE_SUPERUSER_EMAIL in docker-compose.local.yml:130. A fresh
      // isolated PB volume ONLY has that account; any mismatch 400s on
      // pb-auth and the d6 control plane enqueues 0 jobs. (PB 0.22+ also
      // rejects single-label hosts like `admin@localhost`, so the value must
      // carry a TLD regardless.)
      email: "admin@example.com",
      password: "showcase-local-dev",
    },
    // When --isolate offsets the aimock host port, honor env overrides so the
    // harness's host-side references point at the per-project aimock.
    aimockUrl: process.env.AIMOCK_URL_LOCAL || "http://localhost:4010",
    dashboardUrl: process.env.DASHBOARD_URL_LOCAL || "http://localhost:3210",
    dashboardPort: Number(process.env.DASHBOARD_PORT_LOCAL) || 3210,
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
