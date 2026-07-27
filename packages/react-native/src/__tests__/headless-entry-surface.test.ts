import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Guards the `@copilotkit/react-native/headless` entry (src/headless.ts).
 *
 * The whole point of the headless entry is that a consumer using only the
 * provider + agent/tool hooks does NOT have to install (or Metro-stub) the
 * chat/attachment native peer deps. That guarantee lives in the *static import
 * graph*: if any module reachable from src/headless.ts imports the chat
 * components or `useAttachments` — which pull `@gorhom/bottom-sheet`,
 * `expo-document-picker`, `expo-file-system` — the guarantee is silently broken
 * (nothing in a normal typecheck/test catches it, because those are optional
 * peers). This walks the relative-import graph and fails if that happens.
 *
 * Mirrors the export-surface guard added for @copilotkit/react-core/v2/headless
 * (PR #5883).
 */

const srcDir = path.resolve(__dirname, "..");
const headlessEntry = path.join(srcDir, "headless.ts");

// Bare module specifiers a headless consumer must NOT be forced to resolve.
const FORBIDDEN_BARE = [
  "@gorhom/bottom-sheet",
  "expo-document-picker",
  "expo-file-system",
  "react-native-streamdown",
];

// Local modules that carry the chat UI / native-attachment stack.
const FORBIDDEN_LOCAL = [
  "CopilotChat",
  "CopilotModal",
  "CopilotSidebar",
  "CopilotPopup",
  "use-attachments",
];

const importRe =
  /(?:import|export)\s+(?:type\s+)?[^"']*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g;

function resolveLocal(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function walkGraph(entry: string) {
  const seen = new Set<string>();
  const bareSpecs = new Set<string>();
  const localFiles = new Set<string>();
  const stack = [entry];

  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const code = fs.readFileSync(file, "utf8");
    for (const m of code.matchAll(importRe)) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      if (spec.startsWith(".")) {
        const resolved = resolveLocal(file, spec);
        if (resolved) {
          localFiles.add(resolved);
          stack.push(resolved);
        }
      } else {
        bareSpecs.add(spec);
      }
    }
  }
  return { seen, bareSpecs, localFiles };
}

describe("@copilotkit/react-native/headless entry", () => {
  it("has a headless entry file", () => {
    expect(fs.existsSync(headlessEntry)).toBe(true);
  });

  const { seen, bareSpecs } = walkGraph(headlessEntry);

  it("does not pull chat/attachment native peer deps into its import graph", () => {
    const leaked = FORBIDDEN_BARE.filter((dep) =>
      [...bareSpecs].some((s) => s === dep || s.startsWith(`${dep}/`)),
    );
    expect(
      leaked,
      `headless graph must not import: ${leaked.join(", ")}`,
    ).toEqual([]);
  });

  it("does not reach the chat UI / useAttachments modules", () => {
    const reached = [...seen].filter((f) =>
      FORBIDDEN_LOCAL.some((name) =>
        path
          .basename(f)
          .replace(/\.tsx?$/, "")
          .includes(name),
      ),
    );
    expect(
      reached,
      `headless graph must not reach: ${reached
        .map((f) => path.relative(srcDir, f))
        .join(", ")}`,
    ).toEqual([]);
  });

  it("does export the provider + core headless hooks", async () => {
    const mod = await import("../headless");
    for (const name of [
      "CopilotKitProvider",
      "useCopilotKit",
      "useAgent",
      "useFrontendTool",
      "useRenderTool",
      "RenderToolProvider",
    ]) {
      expect(mod, `missing export: ${name}`).toHaveProperty(name);
    }
  });

  it("does NOT re-export chat components or useAttachments from the headless entry", async () => {
    const mod = await import("../headless");
    for (const name of [
      "CopilotChat",
      "CopilotModal",
      "CopilotSidebar",
      "CopilotPopup",
      "useAttachments",
    ]) {
      expect(mod, `headless entry must not export: ${name}`).not.toHaveProperty(
        name,
      );
    }
  });
});
