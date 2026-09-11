import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractCallees } from "../telemetry/extract";

describe("docs prompt controls", () => {
  it("publishes intent and successful copy events with their action context", () => {
    const root = path.join(__dirname, "..", "..");
    const files = [
      "showcase/shell-docs/src/components/hero-onboarding-prompt-button.tsx",
      "showcase/shell-docs/src/components/ai/page-actions.tsx",
    ];
    const events = extractCallees(
      files.map((file) => ({
        path: file,
        content: fs.readFileSync(path.join(root, file), "utf8"),
      })),
      { calleeNames: ["posthog.capture", "capture"] },
    );
    for (const name of [
      "docs.intelligence_onboarding_prompt_action_clicked",
      "docs.intelligence_onboarding_prompt_copied",
    ]) {
      expect(events.find((event) => event.event === name)).toEqual({
        event: name,
        call_sites: files.toSorted(),
        properties_seen: [
          "action",
          "agent_framework",
          "from_path",
          "frontend",
          "onboarding_run_id",
          "surface",
        ],
      });
    }
  });
});
