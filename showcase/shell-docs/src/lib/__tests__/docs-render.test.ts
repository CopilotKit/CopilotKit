import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("../registry", () => ({
  getDocsMode: () => "generated",
}));

import {
  buildFrameworkNav,
  buildFrameworkOnlyNav,
  CONTENT_DIR,
  inlineSnippets,
  loadDoc,
  SNIPPET_MAP,
  SNIPPETS_DIR,
} from "../docs-render";
import type { NavNode } from "../docs-render";

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(SNIPPETS_DIR, "__pdx-208-"));
});

afterEach(() => {
  delete SNIPPET_MAP.Pdx208Parent;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
  vi.restoreAllMocks();
});

function writeSnippet(filename: string, body: string): string {
  const filePath = path.join(tempDir, filename);
  fs.writeFileSync(filePath, body);
  return path.relative(SNIPPETS_DIR, filePath);
}

function hasSectionPage(navTree: NavNode[], section: string, page: string) {
  let inSection = false;
  for (const node of navTree) {
    if (node.type === "section") {
      inSection = node.title === section;
      continue;
    }
    if (inSection && node.type === "page" && node.title === page) return true;
  }
  return false;
}

function collectMdxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectMdxFiles(filePath);
    return entry.isFile() && entry.name.endsWith(".mdx") ? [filePath] : [];
  });
}

describe("inlineSnippets", () => {
  it("recursively inlines helper components imported from snippets", () => {
    const helperRel = writeSnippet("helper.mdx", "Helper body\n");
    const parentRel = writeSnippet(
      "parent.mdx",
      [
        `import Pdx208Helper from "@/snippets/${helperRel}";`,
        "",
        "Before",
        "<Pdx208Helper />",
        "After",
      ].join("\n"),
    );
    SNIPPET_MAP.Pdx208Parent = parentRel;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const rendered = inlineSnippets("<Pdx208Parent />", "pdx-208");

    expect(rendered).toContain("Before");
    expect(rendered).toContain("Helper body");
    expect(rendered).toContain("After");
    expect(rendered).not.toContain("<Pdx208Helper />");
    expect(warnSpy).not.toHaveBeenCalledWith(
      "[docs-render] snippet missing for component",
      "Pdx208Helper",
      "from slug",
      "pdx-208",
    );
  });

  it("preserves non-snippet component imports as runtime components", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const rendered = inlineSnippets(
      [
        'import RuntimeCard from "@/components/runtime-card";',
        "",
        "<RuntimeCard />",
      ].join("\n"),
      "pdx-208-runtime",
    );

    expect(rendered).toContain("<RuntimeCard />");
    expect(warnSpy).not.toHaveBeenCalledWith(
      "[docs-render] snippet missing for component",
      "RuntimeCard",
      "from slug",
      "pdx-208-runtime",
    );
  });

  it("preserves multiline runtime component imports", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const rendered = inlineSnippets(
      [
        "import {",
        "  RuntimeCard,",
        '} from "@/components/runtime-card";',
        "",
        "<RuntimeCard />",
      ].join("\n"),
      "pdx-208-runtime-multiline",
    );

    expect(rendered).toContain("<RuntimeCard />");
    expect(warnSpy).not.toHaveBeenCalledWith(
      "[docs-render] snippet missing for component",
      "RuntimeCard",
      "from slug",
      "pdx-208-runtime-multiline",
    );
  });
});

describe("loadDoc", () => {
  it("resolves clean URLs to files stored under route-group folders", () => {
    const doc = loadDoc("integrations/aws-strands/telemetry");

    expect(doc?.filePath).toContain(
      "integrations/aws-strands/(other)/telemetry/index.mdx",
    );
  });
});

describe("migration docs", () => {
  it("recommends CopilotKit from the v2 entrypoint instead of CopilotKitProvider", () => {
    const snippet = fs.readFileSync(
      path.join(SNIPPETS_DIR, "shared/troubleshooting/migrate-to-v2.mdx"),
      "utf8",
    );

    expect(snippet).toContain(
      "The `<CopilotKit>` provider name — keep using it, but import it from `@copilotkit/react-core/v2`",
    );
    expect(snippet).toContain(
      "Keep the `<CopilotKit>` provider name, but import it from `@copilotkit/react-core/v2`.",
    );
    expect(snippet).toContain(
      'import { CopilotKit, useAgent } from "@copilotkit/react-core/v2";',
    );
    expect(snippet).toContain(
      'import { CopilotKit, CopilotPopup } from "@copilotkit/react-core/v2";',
    );
    expect(snippet).not.toContain("CopilotKitProvider");
  });

  it("keeps v2 reference pages aligned with the CopilotKit v2 entrypoint", () => {
    const referenceIndex = fs.readFileSync(
      path.join(CONTENT_DIR, "..", "reference/index.mdx"),
      "utf8",
    );
    const componentReference = fs.readFileSync(
      path.join(CONTENT_DIR, "..", "reference/components/CopilotKit.mdx"),
      "utf8",
    );

    expect(referenceIndex).toContain(
      'import { CopilotKit } from "@copilotkit/react-core/v2";',
    );
    expect(referenceIndex).not.toContain(
      "CopilotKit is imported from the root package",
    );
    expect(referenceIndex).not.toContain(
      "import `CopilotKit` from `@copilotkit/react-core`",
    );
    expect(componentReference).toContain("`@copilotkit/react-core/v2`");
    expect(componentReference).not.toContain("not from the v2 subpackage");
  });

  it("does not recommend stale v2 package paths in authored docs", () => {
    const authoredDocFiles = collectMdxFiles(CONTENT_DIR);
    const allowedRootProviderImports = new Set([
      path.join(CONTENT_DIR, "migrate/v2.mdx"),
    ]);

    const rootProviderImports = authoredDocFiles.filter((filePath) => {
      if (allowedRootProviderImports.has(filePath)) return false;
      return fs
        .readFileSync(filePath, "utf8")
        .includes('import { CopilotKit } from "@copilotkit/react-core";');
    });

    const oldV2StyleImports = [
      ...authoredDocFiles,
      ...collectMdxFiles(SNIPPETS_DIR),
    ].filter((filePath) =>
      fs
        .readFileSync(filePath, "utf8")
        .includes("@copilotkit/react-ui/v2/styles.css"),
    );

    expect(rootProviderImports).toEqual([]);
    expect(oldV2StyleImports).toEqual([]);
  });
});

describe("framework nav", () => {
  it("includes the shared React Native platform guide in generated framework nav", () => {
    const navTree = buildFrameworkNav(
      "langgraph",
      "LangGraph (Python)",
      "langgraph-python",
    );

    expect(hasSectionPage(navTree, "Platforms", "React Native")).toBe(true);
  });

  it("includes the shared React Native platform guide in authored framework nav", () => {
    const navTree = buildFrameworkOnlyNav("built-in-agent");

    expect(hasSectionPage(navTree, "Platforms", "React Native")).toBe(true);
  });
});
