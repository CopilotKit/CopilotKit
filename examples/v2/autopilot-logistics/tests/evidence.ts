import type { Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function evidencePath(iteration: string, ...parts: string[]): string {
  const root =
    process.env.AUTOPILOT_EVIDENCE_ROOT ??
    resolve(process.cwd(), "../../../.context/autopilot-evidence");
  return resolve(root, iteration, ...parts);
}

/** Keep protocol failures separate from browser/SQL assertions. No prompts or credentials. */
export function captureRuntimeErrors(page: Page, directory: string): void {
  const errors: unknown[] = [];
  page.on("response", async (response) => {
    if (
      !response.url().includes("/api/copilotkit/") ||
      !response.headers()["content-type"]?.includes("text/event-stream")
    )
      return;
    try {
      for (const line of (await response.text()).split("\n")) {
        if (!line.startsWith("data:")) continue;
        const event = JSON.parse(line.slice(5));
        if (event.type === "RUN_ERROR")
          errors.push({
            type: event.type,
            code: event.code,
            message: event.message,
          });
      }
      if (errors.length)
        writeFileSync(
          resolve(directory, "runtime-errors.json"),
          JSON.stringify(errors, null, 2),
        );
    } catch {
      /* A deliberately stopped stream may have no complete body. */
    }
  });
}
