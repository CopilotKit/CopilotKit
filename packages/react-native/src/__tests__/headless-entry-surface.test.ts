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

// ─── #4893 bundle guard ──────────────────────────────────────────────────────
// @copilotkit/react-core/v2 (the "fat" entry) re-exports from a monolithic chunk
// that pulls the chat-message rendering stack: streamdown -> shiki (~5.5 MB of
// grammars + themes), plus mermaid, cytoscape and katex. Metro does not
// tree-shake, so ONE import of that specifier from anywhere in this package puts
// all of it in every consumer's app bundle (issue #4893). PR #5883 moved the lean
// hooks into /v2/headless precisely so this package never needs the fat entry.
const ALLOWED_REACT_CORE_ENTRIES = [
  "@copilotkit/react-core/v2/headless",
  "@copilotkit/react-core/v2/context",
];

// Heavy modules that must never appear as a direct import from this package.
// (Transitive leakage through react-core's own entry is covered separately by
// packages/react-core/scripts/assert-headless-purity.mjs — this walker cannot
// follow into node_modules.)
const FORBIDDEN_HEAVY = [
  "shiki",
  "mermaid",
  "cytoscape",
  "katex",
  "streamdown",
  "@copilotkit/a2ui-renderer",
  "@copilotkit/web-inspector",
  "@copilotkit/runtime-client-gql",
];

const indexEntry = path.join(srcDir, "index.ts");

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
    ]) {
      expect(mod, `missing export: ${name}`).toHaveProperty(name);
    }
  });

  it("exports the render-tool consumption hooks from the headless entry", async () => {
    const mod = await import("../headless");
    // useRenderToolCall: renders a registered component on ANY surface, not just
    // the chat (an in-car stage, a kiosk, a dashboard). useComponent: the
    // controlled generative-UI primitive. Both come from react-core now.
    for (const name of ["useRenderToolCall", "useComponent", "useRenderTool"]) {
      expect(mod, `missing export: ${name}`).toHaveProperty(name);
    }
  });

  it("no longer exports the removed registry hook or its provider", async () => {
    const mod = await import("../headless");
    // Both removed (BREAKING). Asserted so neither creeps back as a shim:
    // useRenderToolRegistry cannot be honoured (core's renderers need
    // name/toolCallId, so a derived Map would silently change the call
    // signature), and RenderToolProvider has nothing left to provide now that
    // registration goes to CopilotKitCoreReact.renderToolCalls.
    for (const name of ["useRenderToolRegistry", "RenderToolProvider"]) {
      expect(mod, `must not export: ${name}`).not.toHaveProperty(name);
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

  // Applies to BOTH entries: the fat-entry ban is package-wide, unlike the
  // native-peer-dep ban above which only constrains the headless entry.
  it.each([
    ["headless", headlessEntry],
    ["default barrel", indexEntry],
  ])(
    "%s entry imports no react-core entry other than /v2/headless and /v2/context",
    (_label, entry) => {
      const { bareSpecs } = walkGraph(entry);
      const offenders = [...bareSpecs].filter(
        (s) =>
          s.startsWith("@copilotkit/react-core") &&
          !ALLOWED_REACT_CORE_ENTRIES.includes(s),
      );
      expect(
        offenders,
        `must import only ${ALLOWED_REACT_CORE_ENTRIES.join(" or ")} — found: ${offenders.join(", ")}. ` +
          `Importing @copilotkit/react-core/v2 drags the shiki/mermaid/katex render stack into every RN bundle (#4893).`,
      ).toEqual([]);
    },
  );

  it.each([
    ["headless", headlessEntry],
    ["default barrel", indexEntry],
  ])(
    "%s entry imports none of the heavy render stack directly",
    (_label, entry) => {
      const { bareSpecs } = walkGraph(entry);
      const leaked = FORBIDDEN_HEAVY.filter((dep) =>
        [...bareSpecs].some((s) => s === dep || s.startsWith(`${dep}/`)),
      );
      expect(leaked, `must not import: ${leaked.join(", ")}`).toEqual([]);
    },
  );
});
