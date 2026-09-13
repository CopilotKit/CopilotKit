/**
 * Materialize frontend sources that must remain byte-identical across showcase
 * integrations. Next resolves dependencies from each integration package, so
 * these files are copied into their package instead of imported through a
 * cross-package runtime symlink. The source below is the only editable copy.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const showcaseRoot = path.resolve(scriptsDir, "..");

const sharedStateReadIntegrations = [
  "strands",
  "langgraph-python",
  "langgraph-typescript",
] as const;

const selectedReactIntegrations = [
  ...sharedStateReadIntegrations,
  "google-adk",
  "built-in-agent",
] as const;

const sharedStateReadWriteIntegrations = selectedReactIntegrations;

function demoTargets(
  integrations: readonly string[],
  demoPath: string,
): string[] {
  return integrations.map((slug) =>
    path.join(showcaseRoot, "integrations", slug, "src/app/demos", demoPath),
  );
}

const sharedFrontendEntries = [
  {
    source: path.join(
      showcaseRoot,
      "shared/react/demos/shared-state-read/page.tsx",
    ),
    targets: demoTargets(
      sharedStateReadIntegrations,
      "shared-state-read/page.tsx",
    ),
  },
  {
    source: path.join(
      showcaseRoot,
      "shared/react/demos/shared-state-read-write/page.tsx",
    ),
    targets: demoTargets(
      sharedStateReadWriteIntegrations,
      "shared-state-read-write/page.tsx",
    ),
  },
  {
    source: path.join(showcaseRoot, "shared/react/demos/gen-ui-agent/page.tsx"),
    targets: demoTargets(selectedReactIntegrations, "gen-ui-agent/page.tsx"),
  },
  {
    source: path.join(showcaseRoot, "shared/react/demos/auth/page.tsx"),
    targets: demoTargets(selectedReactIntegrations, "auth/page.tsx"),
  },
  {
    source: path.join(
      showcaseRoot,
      "shared/react/demos/multimodal/multimodal-chat.tsx",
    ),
    targets: demoTargets(
      selectedReactIntegrations,
      "multimodal/multimodal-chat.tsx",
    ),
  },
  {
    source: path.join(
      showcaseRoot,
      "shared/react/demos/multimodal/file-to-data-attachment.ts",
    ),
    targets: demoTargets(
      selectedReactIntegrations,
      "multimodal/file-to-data-attachment.ts",
    ),
  },
  {
    source: path.join(
      showcaseRoot,
      "shared/react/demos/multimodal/sample-attachment-buttons.tsx",
    ),
    targets: demoTargets(
      selectedReactIntegrations,
      "multimodal/sample-attachment-buttons.tsx",
    ),
  },
  {
    source: path.join(showcaseRoot, "shared/react/demos/voice/voice-chat.tsx"),
    targets: demoTargets(selectedReactIntegrations, "voice/voice-chat.tsx"),
  },
  {
    source: path.join(
      showcaseRoot,
      "shared/react/demos/voice/sample-audio-button.tsx",
    ),
    targets: demoTargets(
      selectedReactIntegrations,
      "voice/sample-audio-button.tsx",
    ),
  },
];

export function syncSharedFrontends(write = false): string[] {
  const drift: string[] = [];

  for (const entry of sharedFrontendEntries) {
    const source = fs.readFileSync(entry.source, "utf8");
    for (const target of entry.targets) {
      const current = fs.readFileSync(target, "utf8");
      if (current === source) continue;
      drift.push(path.relative(showcaseRoot, target));
      if (write) fs.writeFileSync(target, source);
    }
  }

  return drift;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const write = process.argv.includes("--write");
  const drift = syncSharedFrontends(write);
  if (drift.length === 0) {
    console.log("Shared frontend sources are in sync.");
  } else if (write) {
    console.log(
      `Updated ${drift.length} shared frontend target(s):\n${drift.join("\n")}`,
    );
  } else {
    console.error(
      "Shared frontend drift detected. Edit the canonical source under " +
        "showcase/shared/react/demos, then run " +
        `\`pnpm --dir showcase/scripts sync-shared-frontends -- --write\`:\n${drift.join("\n")}`,
    );
    process.exitCode = 1;
  }
}
