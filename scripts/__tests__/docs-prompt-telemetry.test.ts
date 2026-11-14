import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  DOCS_CALLEE_NAMES,
  extractCallees,
  findEmitCalls,
} from "../telemetry/extract";
import type { EmitCall } from "../telemetry/extract";

const REPO_ROOT = path.join(__dirname, "..", "..");
const DOCS_SRC = path.join(REPO_ROOT, "showcase/shell-docs/src");
const PROMPTS = "showcase/shell-docs/src/components/docs-mdx/prompts";

/**
 * The files `emit-fragment.ts --surface docs` reads: every .ts/.tsx under the
 * docs site except tests, as repo-relative paths.
 */
function docsSourceFiles(
  dir: string,
): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "node_modules")
        out.push(...docsSourceFiles(full));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name)
    ) {
      out.push({
        path: path.relative(REPO_ROOT, full),
        content: fs.readFileSync(full, "utf8"),
      });
    }
  }
  return out;
}

const DOCS_FILES = docsSourceFiles(DOCS_SRC);

describe("docs prompt controls", () => {
  // Read through `extractCallees` with the emitter's own callee list, so this
  // pins what the published `CopilotKit.docs` fragment says, not a parallel
  // reading of two files.
  it("publishes intent and successful copy events with their action context", () => {
    const events = extractCallees(DOCS_FILES, {
      calleeNames: DOCS_CALLEE_NAMES,
    });
    for (const name of [
      "docs.intelligence_onboarding_prompt_action_clicked",
      "docs.intelligence_onboarding_prompt_copied",
    ]) {
      const event = events.find((e) => e.event === name);
      expect(event?.call_sites).toEqual(
        expect.arrayContaining([
          `${PROMPTS}/page-agent-prompt.tsx`,
          `${PROMPTS}/prompt-actions.tsx`,
        ]),
      );
      expect(event?.properties_seen).toEqual([
        "action",
        "agent_framework",
        // The revision of the argument prose appended to the copied link,
        // and the prose itself. The hosted document versions its own text;
        // these are the other half of what the developer copied (PE-255).
        "argument_text",
        "argument_version",
        "channel",
        "from_path",
        "frontend",
        "onboarding_run_id",
        "surface",
      ]);
    }
  });
});

/**
 * Emit calls that belong to an onboarding prompt but don't say which control
 * the developer used. A call belongs to a prompt if it sends a prompt event
 * (`*_prompt_copied`, `*_prompt_action_clicked`) or carries a run id, which
 * every prompt control mints.
 */
function unattributed(calls: EmitCall[]): string[] {
  return calls
    .filter(
      (call) =>
        (call.properties.includes("onboarding_run_id") ||
          call.events.some((e) =>
            /_prompt_(copied|action_clicked)$/.test(e.event),
          )) &&
        !call.properties.includes("action"),
    )
    .map(
      (call) =>
        `${call.path}:${call.line} (${call.events.map((e) => e.event).join(", ")})`,
    );
}

// The wizard shipped a `prompt_copied` emitter with no `action`, and nothing
// caught it: the pin above names two files by hand, `extractCallees` only read
// string-literal event names (the wizard passed a constant), and this file was
// wired into no CI job at all. This walks every emit call the fragment
// emitter finds and keys off the event shape instead of a file list, so a new
// prompt control cannot ship unattributed. See PE-218.
describe("every docs prompt emitter", () => {
  it("attributes its event to the control the developer used", () => {
    expect(unattributed(findEmitCalls(DOCS_FILES, DOCS_CALLEE_NAMES))).toEqual(
      [],
    );
  });

  it("flags a prompt emitter that drops the action", () => {
    const files = [
      {
        path: "events.ts",
        content: `export const EVENTS = { copied: "docs.x_prompt_copied" } as const;`,
      },
      {
        path: "control.tsx",
        content: `
          function Control({ runId }: { runId: string }) {
            const properties = { onboarding_run_id: runId, surface: "s" };
            const onCopied = () => trackEvent(EVENTS.copied, { ...properties });
            const onAction = (action: string) =>
              trackEvent("docs.y_clicked", { ...properties, action });
            return null;
          }`,
      },
    ];
    expect(unattributed(findEmitCalls(files, DOCS_CALLEE_NAMES))).toEqual([
      "control.tsx:4 (docs.x_prompt_copied)",
    ]);
  });
});
