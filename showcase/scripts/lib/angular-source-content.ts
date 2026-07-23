import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

interface SourceFile {
  language: "css" | "html" | "typescript";
  content: string;
}

export interface AngularSourceContent {
  files: Record<string, SourceFile>;
  defaultFileByFeature: Record<string, string>;
}

const FEATURE_GROUPS: ReadonlyArray<{
  file: string;
  features: readonly string[];
}> = [
  {
    file: "features/popup-feature.component.ts",
    features: ["prebuilt-popup"],
  },
  {
    file: "features/sidebar-feature.component.ts",
    features: ["prebuilt-sidebar"],
  },
  {
    file: "features/chat-slots-feature.component.ts",
    features: ["chat-slots"],
  },
  {
    file: "features/chat-css-feature.component.ts",
    features: ["chat-customization-css"],
  },
  {
    file: "features/headless/headless-simple-feature.component.ts",
    features: ["headless-simple"],
  },
  {
    file: "features/headless/headless-complete-feature.component.ts",
    features: ["headless-complete"],
  },
  {
    file: "features/tools/tool-feature.component.ts",
    features: [
      "gen-ui-tool-based",
      "tool-rendering-default-catchall",
      "tool-rendering-custom-catchall",
      "tool-rendering",
      "tool-rendering-reasoning-chain",
      "frontend-tools",
      "frontend-tools-async",
      "threadid-frontend-tool-roundtrip",
      "hitl-in-chat",
      "hitl-in-app",
    ],
  },
  {
    file: "features/interrupt/interrupt-feature.component.ts",
    features: ["gen-ui-interrupt", "interrupt-headless"],
  },
  {
    file: "features/a2ui/a2ui-feature.component.ts",
    features: ["declarative-gen-ui", "a2ui-fixed-schema", "a2ui-recovery"],
  },
  {
    file: "features/generated-ui/generated-ui-feature.component.ts",
    features: ["open-gen-ui", "open-gen-ui-advanced"],
  },
  {
    file: "features/generated-ui/mcp-apps-feature.component.ts",
    features: ["mcp-apps"],
  },
  {
    file: "features/state/state-feature.component.ts",
    features: [
      "shared-state-read-write",
      "shared-state-read",
      "shared-state-streaming",
      "readonly-state-agent-context",
    ],
  },
  {
    file: "features/reasoning-feature.component.ts",
    features: ["reasoning-default", "reasoning-custom"],
  },
  {
    file: "features/agent-state/agent-state-feature.component.ts",
    features: ["gen-ui-agent", "subagents"],
  },
  {
    file: "features/mastra/mastra-feature.component.ts",
    features: ["background-agents", "observational-memory", "browser-use"],
  },
  {
    file: "features/app-settings/app-settings-feature.component.ts",
    features: ["auth", "agent-config"],
  },
  {
    file: "features/media/media-feature.component.ts",
    features: ["voice", "multimodal"],
  },
  {
    file: "features/beautiful-chat/beautiful-chat-feature.component.ts",
    features: ["beautiful-chat"],
  },
  {
    file: "features/chat-feature.component.ts",
    features: ["agentic-chat"],
  },
];

function sourceLanguage(filename: string): SourceFile["language"] {
  switch (extname(filename)) {
    case ".css":
      return "css";
    case ".html":
      return "html";
    default:
      return "typescript";
  }
}

function readSourceTree(root: string): Record<string, SourceFile> {
  const files: Record<string, SourceFile> = {};

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "generated") visit(absolute);
        continue;
      }
      if (
        entry.name.endsWith(".test.ts") ||
        ![".css", ".html", ".ts"].includes(extname(entry.name))
      ) {
        continue;
      }
      const filename = relative(root, absolute).replaceAll("\\", "/");
      files[filename] = {
        language: sourceLanguage(filename),
        content: readFileSync(absolute, "utf8"),
      };
    }
  }

  visit(root);
  return files;
}

/** Build the source bundle used by Angular Showcase code routes. */
export function buildAngularSourceContent(
  showcaseRoot: string,
): AngularSourceContent {
  const appRoot = join(showcaseRoot, "angular/src/app");
  const registry = JSON.parse(
    readFileSync(join(showcaseRoot, "shared/frontend-registry.json"), "utf8"),
  ) as {
    feature_support: Record<string, { angular: { state: string } }>;
  };
  const supported = Object.entries(registry.feature_support)
    .filter(([, support]) => support.angular.state === "supported")
    .map(([feature]) => feature)
    .sort();
  const defaultFileByFeature = Object.fromEntries(
    FEATURE_GROUPS.flatMap(({ file, features }) =>
      features.map((feature) => [feature, file]),
    ),
  );

  if (
    JSON.stringify(Object.keys(defaultFileByFeature).sort()) !==
    JSON.stringify(supported)
  ) {
    throw new Error(
      "Angular source defaults must match the supported feature registry.",
    );
  }

  const files = readSourceTree(appRoot);
  for (const [feature, filename] of Object.entries(defaultFileByFeature)) {
    if (!files[filename]) {
      throw new Error(
        `Angular feature ${JSON.stringify(feature)} points to missing source ${JSON.stringify(filename)}.`,
      );
    }
  }

  return { files, defaultFileByFeature };
}
