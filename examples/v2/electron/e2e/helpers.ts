import { _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __e2eDir = dirname(fileURLToPath(import.meta.url));

export const APP_ROOT = join(__e2eDir, "..");
export const ARTIFACTS_DIR = join(__e2eDir, ".artifacts");
export const MAIN_ENTRY = join(APP_ROOT, "out", "main", "index.js");

// NOTE: this reads the Playwright *runner* process env — not the app's .env.
// The Electron app loads provider keys via dotenv from `examples/v2/electron/.env`,
// so a key present only there (not exported in your shell) leaves this `false`
// and the round-trip test skips. It fails safe — it never launches a doomed run.
export const hasProviderKey = !!(
  process.env.OPENAI_API_KEY?.trim() ||
  process.env.ANTHROPIC_API_KEY?.trim() ||
  process.env.GOOGLE_API_KEY?.trim()
);

export async function launchElectronApp(): Promise<{
  app: ElectronApplication;
  page: Page;
}> {
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    cwd: APP_ROOT,
    env: { ...process.env, NODE_ENV: "production" },
    recordVideo: { dir: ARTIFACTS_DIR, size: { width: 1100, height: 760 } },
    timeout: 30_000,
  });
  const page = await app.firstWindow();
  return { app, page };
}
