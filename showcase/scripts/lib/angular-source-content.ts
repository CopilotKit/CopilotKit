import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

interface SourceFile {
  language: "css" | "html" | "typescript";
  content: string;
}

export interface AngularSourceRegion extends SourceFile {
  file: string;
  startLine: number;
  endLine: number;
}

export interface AngularSourceContent {
  files: Record<string, SourceFile>;
  defaultFileByFeature: Record<string, string>;
  regions: Record<string, AngularSourceRegion>;
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

const REGION_START = /@region\[([a-z0-9][a-z0-9-]*)\]/;
const REGION_END = /@endregion\[([a-z0-9][a-z0-9-]*)\]/;

function extractRegions(
  content: string,
  file: string,
  language: SourceFile["language"],
): { content: string; regions: Record<string, AngularSourceRegion> } {
  const cleaned: string[] = [];
  const open: Array<{ name: string; startLine: number; lines: string[] }> = [];
  const regions: Record<string, AngularSourceRegion> = {};

  for (const line of content.split("\n")) {
    const start = line.match(REGION_START);
    const end = line.match(REGION_END);
    if (start && end) {
      throw new Error(`${file}: region markers must use separate lines.`);
    }
    if (start) {
      if (
        regions[start[1]] ||
        open.some((region) => region.name === start[1])
      ) {
        throw new Error(`${file}: duplicate Angular region ${start[1]}.`);
      }
      open.push({
        name: start[1],
        startLine: cleaned.length + 1,
        lines: [],
      });
      continue;
    }
    if (end) {
      const region = open.pop();
      if (!region || region.name !== end[1]) {
        throw new Error(`${file}: unmatched Angular region end ${end[1]}.`);
      }
      regions[region.name] = {
        file,
        language,
        content: region.lines.join("\n"),
        startLine: region.startLine,
        endLine: cleaned.length,
      };
      continue;
    }

    cleaned.push(line);
    for (const region of open) region.lines.push(line);
  }

  if (open.length > 0) {
    throw new Error(`${file}: unclosed Angular region ${open.at(-1)?.name}.`);
  }

  return { content: cleaned.join("\n"), regions };
}

function readSourceTree(root: string): {
  files: Record<string, SourceFile>;
  regions: Record<string, AngularSourceRegion>;
} {
  const files: Record<string, SourceFile> = {};
  const regions: Record<string, AngularSourceRegion> = {};

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
      const language = sourceLanguage(filename);
      const extracted = extractRegions(
        readFileSync(absolute, "utf8"),
        filename,
        language,
      );
      files[filename] = {
        language,
        content: extracted.content,
      };
      for (const [name, region] of Object.entries(extracted.regions)) {
        if (regions[name]) {
          throw new Error(
            `Angular region ${name} is declared in both ${regions[name].file} and ${filename}.`,
          );
        }
        regions[name] = region;
      }
    }
  }

  visit(root);
  return { files, regions };
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

  const { files, regions } = readSourceTree(appRoot);
  for (const [feature, filename] of Object.entries(defaultFileByFeature)) {
    if (!files[filename]) {
      throw new Error(
        `Angular feature ${JSON.stringify(feature)} points to missing source ${JSON.stringify(filename)}.`,
      );
    }
  }

  return { files, defaultFileByFeature, regions };
}
