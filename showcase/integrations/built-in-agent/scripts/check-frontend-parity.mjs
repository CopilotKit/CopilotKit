import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(__filename), "..");
const referenceRoot = path.resolve(packageRoot, "../langgraph-python");

const parityRoots = [
  "src/app/demos",
  "src/components/ui",
  "src/lib/utils.ts",
  "src/app/globals.css",
  "public/demo-files",
  "public/demo-audio",
];

const allowedContentDiffs = new Set([
  // Built-in Agent docs/comments must name the in-process runtime, factory
  // files, and generated docs URLs instead of LangGraph/Python files. These
  // paths keep the same rendered frontend behavior as LangGraph Python.
  "src/app/demos/a2ui-fixed-schema/a2ui/definitions.ts",
  "src/app/demos/a2ui-fixed-schema/page.tsx",
  "src/app/demos/agent-config/page.tsx",
  "src/app/demos/agentic-chat/README.md",
  "src/app/demos/chat-slots/suggestions.ts",
  "src/app/demos/declarative-gen-ui/a2ui/catalog.ts",
  "src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "src/app/demos/declarative-gen-ui/page.tsx",
  "src/app/demos/gen-ui-agent/page.tsx",
  "src/app/demos/headless-simple/chat.tsx",
  "src/app/demos/mcp-apps/page.tsx",
  "src/app/demos/multimodal/legacy-converter-shim.tsx",
  "src/app/demos/multimodal/page.tsx",
  "src/app/demos/subagents/README.md",
  // Docs-only slot snippet: same teaching regions, shorter wording because
  // the Built-in Agent copy does not need to explain LangGraph casts.
  "src/app/demos/chat-slots/slot-overrides.snippet.tsx",
  // Built-in Agent docs generation needs this region around `useAgentContext`.
  "src/app/demos/agent-config/config-context-relay.tsx",
  // Metadata titles are product-specific, not part of the demo UI surface.
  "src/app/demos/layout.tsx",
  // These interrupt demos are intentionally listed in manifest
  // `not_supported_features`; the frontend files remain wired for docs but
  // use framework-neutral wording and fail-loud logging.
  "src/app/demos/gen-ui-interrupt/page.tsx",
  "src/app/demos/interrupt-headless/page.tsx",
  // The built-in-agent package keeps CopilotKit demo tools on zod v3 while
  // json-render's public types are compiled against zod v4. Use the existing
  // zod4 alias only for this json-render catalog so `tsc --noEmit` remains
  // clean without changing the rendered UI.
  "src/app/demos/declarative-json-render/catalog.ts",
  "src/app/demos/declarative-json-render/registry.tsx",
  // CopilotKit 1.59.4 exports ToolResult rather than ToolMessage and the
  // error event no longer exposes `code` directly. These are type-only
  // compatibility adjustments for the installed package version.
  "src/app/demos/auth/page.tsx",
  "src/app/demos/headless-complete/chat/message-list.tsx",
  // Built-in-agent uses the runtime's in-memory runner, which rejects a
  // second run while the same thread is still active. The copied multimodal
  // sample buttons need a tiny idle wait around runAgent() so the image and
  // PDF sample clicks remain deterministic under the D6 harness.
  "src/app/demos/multimodal/sample-attachment-buttons.tsx",
]);

function hashFile(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function collect(relativeRoot) {
  const absoluteRoot = path.join(packageRoot, relativeRoot);
  const referenceAbsoluteRoot = path.join(referenceRoot, relativeRoot);
  const files = new Map();

  if (!fs.existsSync(absoluteRoot)) {
    files.set("__missing-root__", null);
    return files;
  }

  const walk = (absoluteDir) => {
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const absolutePath = path.join(absoluteDir, entry.name);
      const relativePath = path.relative(referenceAbsoluteRoot, absolutePath);

      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        files.set(relativePath, hashFile(absolutePath));
      }
    }
  };

  walk(absoluteRoot);
  return files;
}

function diffRoot(relativeRoot) {
  const referenceFiles = collectFromRoot(referenceRoot, relativeRoot);
  const candidateFiles = collectFromRoot(packageRoot, relativeRoot);
  const paths = new Set([...referenceFiles.keys(), ...candidateFiles.keys()]);
  const diffs = [];

  for (const relativePath of [...paths].sort()) {
    const referenceHash = referenceFiles.get(relativePath);
    const candidateHash = candidateFiles.get(relativePath);
    if (referenceHash === candidateHash) continue;

    const label = path.join(relativeRoot, relativePath);
    if (referenceHash === undefined) {
      diffs.push(`extra file: ${label}`);
    } else if (candidateHash === undefined) {
      diffs.push(`missing file: ${label}`);
    } else {
      if (allowedContentDiffs.has(label)) continue;
      diffs.push(`content differs: ${label}`);
    }
  }

  return diffs;
}

function collectFromRoot(root, relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  const files = new Map();

  if (!fs.existsSync(absoluteRoot)) {
    return files;
  }

  if (fs.statSync(absoluteRoot).isFile()) {
    files.set(path.basename(relativeRoot), hashFile(absoluteRoot));
    return files;
  }

  const walk = (absoluteDir) => {
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const absolutePath = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        files.set(path.relative(absoluteRoot, absolutePath), hashFile(absolutePath));
      }
    }
  };

  walk(absoluteRoot);
  return files;
}

const diffs = parityRoots.flatMap(diffRoot);

if (diffs.length > 0) {
  console.error("built-in-agent frontend parity check failed:");
  for (const diff of diffs.slice(0, 80)) {
    console.error(`- ${diff}`);
  }
  if (diffs.length > 80) {
    console.error(`- ...and ${diffs.length - 80} more`);
  }
  process.exit(1);
}

console.log(
  `built-in-agent frontend parity matches langgraph-python (${allowedContentDiffs.size} allowed BIA adaptation).`,
);
