import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { ɵcopilotIconSvgAttributes, ɵcopilotIcons } from "../icons";
import type { CopilotIconData, CopilotIconName } from "../icons";

// Code name -> Lucide 0.525 icon file. lucide-react renders the
// `lucide-<file>` class for each of these, and user CSS selects it.
const expectedLucideFiles: readonly (readonly [CopilotIconName, string])[] = [
  ["ArrowUp", "arrow-up"],
  ["Check", "check"],
  ["ChevronDown", "chevron-down"],
  ["ChevronLeft", "chevron-left"],
  ["ChevronRight", "chevron-right"],
  ["Circle", "circle"],
  ["Copy", "copy"],
  ["Edit", "square-pen"],
  ["EyeOff", "eye-off"],
  ["Loader2", "loader-circle"],
  ["MessageCircle", "message-circle"],
  ["Mic", "mic"],
  ["PanelLeftOpen", "panel-left-open"],
  ["Play", "play"],
  ["Plus", "plus"],
  ["RefreshCw", "refresh-cw"],
  ["Square", "square"],
  ["ThumbsDown", "thumbs-down"],
  ["ThumbsUp", "thumbs-up"],
  ["Upload", "upload"],
  ["Volume2", "volume-2"],
  ["Wrench", "wrench"],
  ["X", "x"],
];

type LucideIconNode = readonly (readonly [string, Record<string, string>])[];

// `lucide` is not a dependency of core, so resolve it through web-inspector,
// which depends on it. The per-icon ESM files are plain data modules.
const requireFromWebInspector = createRequire(
  new URL("../../../../web-inspector/package.json", import.meta.url),
);
const lucideRoot = dirname(
  requireFromWebInspector.resolve("lucide/package.json"),
);
const lucideVersion: string = requireFromWebInspector(
  "lucide/package.json",
).version;

async function loadLucideIcon(file: string) {
  const url = pathToFileURL(join(lucideRoot, "dist/esm/icons", `${file}.js`));
  const module: { default: LucideIconNode } = await import(url.href);
  return module.default;
}

const lucideNodesByName = new Map(
  await Promise.all(
    expectedLucideFiles.map(
      async ([name, file]) => [name, await loadLucideIcon(file)] as const,
    ),
  ),
);

function toLucideNodes(nodes: CopilotIconData) {
  return nodes.map((node) => [node.tag, node.attributes]);
}

describe("ɵcopilotIcons", () => {
  it("is compared against Lucide 0.525.0", () => {
    expect(lucideVersion).toBe("0.525.0");
  });

  it("has exactly the chat icon names", () => {
    expect(Object.keys(ɵcopilotIcons).sort()).toEqual(
      expectedLucideFiles.map(([name]) => name).sort(),
    );
  });

  it.each(expectedLucideFiles)(
    "%s uses the Lucide name %s and its exact SVG data",
    (name, file) => {
      const icon = ɵcopilotIcons[name];

      expect(icon.name).toBe(file);
      expect(toLucideNodes(icon.nodes)).toEqual(lucideNodesByName.get(name));
    },
  );
});

describe("ɵcopilotIconSvgAttributes", () => {
  it("matches Lucide's default SVG attributes", () => {
    expect(ɵcopilotIconSvgAttributes).toEqual({
      xmlns: "http://www.w3.org/2000/svg",
      width: "24",
      height: "24",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });
  });
});
