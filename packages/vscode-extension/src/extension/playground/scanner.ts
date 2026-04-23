import * as fs from "node:fs";
import { scanWorkspace } from "../hooks/hook-scanner";
import { findCopilotKitNodes } from "./find-copilotkit";
import { serializeJsxProps } from "./serialize-props";
import { walkSameFileAncestors } from "./walk-ancestors";
import { mapHooksToComponents } from "./map-hooks-to-components";
import { parseSync } from "oxc-parser";
import type {
  PlaygroundScanResult,
  CopilotKitProviderLocation,
  ComponentWithHooks,
  ScanWarning,
  ProviderChainEntry,
} from "./types";

export function scanPlayground(workspaceRoot: string): PlaygroundScanResult {
  if (!fs.existsSync(workspaceRoot)) {
    return { providers: [], componentsWithHooks: [], hookSites: [], warnings: [] };
  }

  // Reuse the existing workspace walk — it handles .gitignore, size caps,
  // test-file exclusions, and oxc parsing. hookSites comes for free.
  const { sites: hookSites, capped } = scanWorkspace(workspaceRoot);

  const warnings: ScanWarning[] = [];
  if (capped) {
    warnings.push({
      kind: "scan-error",
      message:
        "Workspace file cap hit during scan. Some files were skipped — add them to .gitignore or narrow the workspace.",
    });
  }

  const providers: CopilotKitProviderLocation[] = [];
  let ancestorChain: ProviderChainEntry[] | undefined;

  // Collect every file that might contain a <CopilotKit> provider:
  // - Files that already surfaced hooks (they import @copilotkit/react-core).
  // - Every other .ts/.tsx in the workspace (prefilter by string match).
  const touchedFiles = new Set(hookSites.map((s) => s.filePath));
  walkFilesForProvider(workspaceRoot, touchedFiles);

  for (const filePath of touchedFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const nodes = findCopilotKitNodes(filePath, content);
    if (nodes.length === 0) continue;

    for (const node of nodes) {
      const props = serializeJsxProps(node.openingElement, content);
      providers.push({ filePath, loc: node.loc, props });
    }

    // Only compute ancestor chain for the FIRST provider in the FIRST file.
    // (Plan §10: multi-provider workspaces pick the first and warn.)
    if (ancestorChain === undefined && nodes.length > 0) {
      try {
        const res = parseSync(filePath, content, {
          lang: filePath.endsWith(".tsx") ? "tsx" : "ts",
          sourceType: "module",
        });
        if (res.errors.length === 0) {
          ancestorChain = walkSameFileAncestors(
            nodes[0].jsxElement,
            res.program,
            content,
            filePath,
          );
        }
      } catch {
        /* non-fatal */
      }
    }
  }

  if (providers.length > 1) {
    const rest = providers
      .slice(1)
      .map((p) => `${p.filePath}:${p.loc.line}`)
      .join(", ");
    warnings.push({
      kind: "multiple-providers",
      message: `Multiple <CopilotKit> providers found. Using ${providers[0].filePath}:${providers[0].loc.line}. Others: ${rest}`,
    });
  }

  // Group hooks by component.
  const componentsWithHooks: ComponentWithHooks[] = [];
  const sitesByFile = groupBy(hookSites, (s) => s.filePath);
  for (const [filePath, fileSites] of sitesByFile) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const { components, warnings: fileWarnings } = mapHooksToComponents(
      filePath,
      content,
      fileSites,
    );
    componentsWithHooks.push(...components);
    warnings.push(...fileWarnings);
  }

  return {
    providers,
    ancestorChain,
    componentsWithHooks,
    hookSites,
    warnings,
  };
}

function groupBy<T, K>(items: T[], keyOf: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const item of items) {
    const k = keyOf(item);
    const list = m.get(k);
    if (list) list.push(item);
    else m.set(k, [item]);
  }
  return m;
}

/**
 * Augments the touched-files set with every .tsx/.ts file in the workspace
 * that might reference the CopilotKit package. Cheap to call — we let the
 * downstream `findCopilotKitNodes` prefilter do the final string match.
 */
function walkFilesForProvider(root: string, acc: Set<string>): void {
  const EXCLUDE = new Set([
    "node_modules",
    "dist",
    ".git",
    ".next",
    "build",
    ".turbo",
    "out",
    "__tests__",
    "__fixtures__",
    "__mocks__",
  ]);
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (EXCLUDE.has(e.name.toLowerCase())) continue;
        walk(full);
        continue;
      }
      if (!e.name.endsWith(".tsx") && !e.name.endsWith(".ts")) continue;
      if (
        e.name.includes(".test.") ||
        e.name.includes(".spec.") ||
        e.name.includes(".stories.")
      )
        continue;
      acc.add(full);
    }
  };
  walk(root);
}
