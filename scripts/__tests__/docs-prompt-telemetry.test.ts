import { describe, it, expect } from "vitest";
import ts from "typescript";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractCallees } from "../telemetry/extract";

const REPO_ROOT = path.join(__dirname, "..", "..");
const DOCS_SRC = path.join(REPO_ROOT, "showcase/shell-docs/src");

/** Every .ts/.tsx under the docs site, minus tests and pure MDX content. */
function docsSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "content")
        out.push(...docsSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** The inline object keys of a `capture(event, { ... })` second argument. */
function inlineKeys(node: ts.Expression | undefined): string[] {
  if (!node || !ts.isObjectLiteralExpression(node)) return [];
  return node.properties.flatMap((prop) =>
    prop.name && ts.isIdentifier(prop.name) ? [prop.name.text] : [],
  );
}

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
        ],
      });
    }
  });
});

// The wizard shipped a `prompt_copied` emitter with no `action`, and nothing
// caught it: the pin above names two files by hand, `extractCallees` only reads
// string-literal event names (the wizard passes a constant), and this file was
// wired into no CI job at all. This walks the tree and keys off the event
// shape instead of a file list or an event name, so a new prompt control
// cannot ship unattributed. See PE-218.
describe("every docs prompt emitter", () => {
  it("attributes its event to the control the developer used", () => {
    const unattributed: string[] = [];
    for (const file of docsSourceFiles(DOCS_SRC)) {
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          const name = ts.isIdentifier(callee)
            ? callee.text
            : ts.isPropertyAccessExpression(callee)
              ? callee.name.text
              : "";
          const keys = inlineKeys(node.arguments[1]);
          // A run id is what makes an event part of an onboarding prompt
          // journey, and every prompt control mints one. Keying off it costs
          // nothing to maintain and cannot be sidestepped by naming a new
          // event or a new file.
          if (
            name === "capture" &&
            keys.includes("onboarding_run_id") &&
            !keys.includes("action")
          ) {
            const line =
              source.getLineAndCharacterOfPosition(node.getStart(source)).line +
              1;
            unattributed.push(
              `${path.relative(REPO_ROOT, file)}:${line} (${node.arguments[0].getText(source)})`,
            );
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(unattributed).toEqual([]);
  });
});
