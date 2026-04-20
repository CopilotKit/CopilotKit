import * as vscode from "vscode";
import * as path from "node:path";
import type { DiscoveredComponent } from "./types";
import { PreviewPanel } from "./preview-panel";
import { FileWatcher } from "./file-watcher";
import { CatalogListViewProvider } from "./sidebar/catalog-list-view-provider";
import {
  findFixtureFile,
  getFixtureNames,
  scanDirectory,
} from "./sidebar/component-scanner";
import { parseFixtureJson, validateFixture } from "./fixture-validator";
import { ComponentRegistry } from "./component-registry";
import { InspectorPanel } from "./inspector-panel";
import { InspectorViewProvider } from "./inspector-view-provider";
import { DebugStream } from "./debug-stream";
import { activateHookExplorer } from "./hooks/activate-hook-explorer";

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // Component registry — scans catalog files and extracts valid component names.
  // Used by the fixture validator to check component types.
  const registry = new ComponentRegistry();

  // Diagnostics collection for fixture validation
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("copilotkit");
  context.subscriptions.push(diagnosticCollection);

  // Live fixture validation — runs on every change to .fixture.* files
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const fsPath = event.document.uri.fsPath;
      if (!fsPath.includes(".fixture.")) return;
      validateFixtureDocument(event.document, diagnosticCollection, registry);
    }),
  );

  // Also validate when a fixture file is opened
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (!doc.uri.fsPath.includes(".fixture.")) return;
      validateFixtureDocument(doc, diagnosticCollection, registry);
    }),
  );

  // Validate any already-open fixture files
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.fsPath.includes(".fixture.")) {
      validateFixtureDocument(doc, diagnosticCollection, registry);
    }
  }

  // Preview panel
  const previewPanel = new PreviewPanel(
    context.extensionUri,
    diagnosticCollection,
    registry,
  );

  // Sidebar (webview). The provider owns rendering + messaging; workspace
  // scanning is done here so we can reuse the same pass to seed the
  // component registry used by fixture validation.
  let discoveredComponents: DiscoveredComponent[] = workspaceRoot
    ? scanDirectory(workspaceRoot)
    : [];
  for (const comp of discoveredComponents) registry.register(comp.filePath);

  const rescanCatalogs = () => {
    discoveredComponents = workspaceRoot ? scanDirectory(workspaceRoot) : [];
    for (const comp of discoveredComponents) registry.register(comp.filePath);
    catalogProvider.setComponents(discoveredComponents);
  };

  const catalogProvider = new CatalogListViewProvider(
    context.extensionUri,
    workspaceRoot ?? null,
    {
      onPreview: (component, fixtureName) =>
        previewPanel.show(component, fixtureName),
      onOpenSource: async (component, fixtureName) => {
        // Fixture row → open the fixture file and highlight the named key.
        // Component row → open the component source.
        const targetPath =
          fixtureName && component.fixturePath
            ? component.fixturePath
            : component.filePath;
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(targetPath),
        );
        const editor = await vscode.window.showTextDocument(doc);
        if (fixtureName) {
          const text = doc.getText();
          const idx = text.indexOf(`"${fixtureName}"`);
          if (idx >= 0) {
            const pos = doc.positionAt(idx);
            editor.revealRange(
              new vscode.Range(pos, pos),
              vscode.TextEditorRevealType.InCenter,
            );
            editor.selection = new vscode.Selection(pos, pos);
          }
        }
      },
      onRefresh: rescanCatalogs,
    },
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      CatalogListViewProvider.viewType,
      catalogProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );
  catalogProvider.setComponents(discoveredComponents);

  // File watcher — updates sidebar, preview, and component registry on changes
  const fileWatcher = new FileWatcher((filePath) => {
    rescanCatalogs();
    previewPanel.handleFileChange(filePath);

    // Update registry when catalog files change
    if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
      registry.update(filePath);
      // Re-validate all open fixture files (component names may have changed)
      for (const doc of vscode.workspace.textDocuments) {
        if (doc.uri.fsPath.includes(".fixture.")) {
          validateFixtureDocument(doc, diagnosticCollection, registry);
        }
      }
    }
  });
  context.subscriptions.push(fileWatcher);

  // Command: Preview from command palette (uses active editor)
  context.subscriptions.push(
    vscode.commands.registerCommand("copilotkit.previewComponent", () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        vscode.window.showWarningMessage(
          "No active editor. Open a component file first.",
        );
        return;
      }

      const filePath = activeEditor.document.uri.fsPath;
      if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) {
        vscode.window.showWarningMessage(
          "Active file is not a TypeScript file.",
        );
        return;
      }

      const component = buildComponent(filePath);
      previewPanel.show(component);
    }),
  );

  // Command: Preview from explorer context menu
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "copilotkit.previewComponentFromExplorer",
      (uri: vscode.Uri) => {
        const component = buildComponent(uri.fsPath);
        previewPanel.show(component);
      },
    ),
  );

  // Command: Preview from sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "copilotkit.previewComponentFromSidebar",
      (component: DiscoveredComponent, fixtureName?: string) => {
        previewPanel.show(component, fixtureName);
      },
    ),
  );

  // Command: Refresh components list
  context.subscriptions.push(
    vscode.commands.registerCommand("copilotkit.refreshComponents", () =>
      rescanCatalogs(),
    ),
  );

  // Shared debug stream — used by both sidebar view and editor panel
  const debugStream = new DebugStream();
  context.subscriptions.push({ dispose: () => debugStream.dispose() });

  // Inspector sidebar view
  const inspectorViewProvider = new InspectorViewProvider(
    context.extensionUri,
    debugStream,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      InspectorViewProvider.viewType,
      inspectorViewProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  // Inspector editor panel (opened via command)
  const inspectorPanel = new InspectorPanel(context.extensionUri, debugStream);

  context.subscriptions.push(
    vscode.commands.registerCommand("copilotkit.openInspector", () => {
      inspectorPanel.show();
    }),
  );

  context.subscriptions.push({ dispose: () => inspectorPanel.dispose() });

  // ----- Hook Explorer -----
  // All wiring (tree, panel, persistence, scan, 5 commands) lives in its own
  // module so this file stays a thin composition root.
  activateHookExplorer(context, workspaceRoot);
}

export function deactivate(): void {}

/**
 * Validates a fixture document and sets diagnostics (yellow squiggly lines).
 * Runs on every keystroke for .fixture.json and .fixture.ts files.
 */
function validateFixtureDocument(
  doc: vscode.TextDocument,
  diagnostics: vscode.DiagnosticCollection,
  registry: ComponentRegistry,
): void {
  const fsPath = doc.uri.fsPath;
  const content = doc.getText();

  if (fsPath.endsWith(".fixture.json")) {
    const result = parseFixtureJson(content);
    if (result.valid) {
      diagnostics.delete(doc.uri);

      const validComponents = registry.getValidComponents(fsPath);
      const errors: vscode.Diagnostic[] = [];
      if (result.fixtures) {
        for (const [name, fixture] of Object.entries(result.fixtures)) {
          validateFixtureMessages(
            content,
            name,
            fixture.messages,
            errors,
            validComponents,
            registry,
            fsPath,
          );
        }
      }
      if (errors.length > 0) {
        diagnostics.set(doc.uri, errors);
      }
    } else {
      const diags = result.errors.map(
        (err) =>
          new vscode.Diagnostic(
            new vscode.Range((err.line ?? 1) - 1, 0, (err.line ?? 1) - 1, 100),
            err.message,
            vscode.DiagnosticSeverity.Warning,
          ),
      );
      diagnostics.set(doc.uri, diags);
    }
  } else if (
    fsPath.endsWith(".fixture.ts") ||
    fsPath.endsWith(".fixture.tsx")
  ) {
    const result = validateFixture(fsPath, content);
    if (result.valid) {
      diagnostics.delete(doc.uri);
    } else {
      const diags = result.errors.map(
        (err) =>
          new vscode.Diagnostic(
            new vscode.Range((err.line ?? 1) - 1, 0, (err.line ?? 1) - 1, 100),
            err.message,
            vscode.DiagnosticSeverity.Warning,
          ),
      );
      diagnostics.set(doc.uri, diags);
    }
  }
}

/**
 * Deep-validates fixture messages against the A2UI v0.9 protocol.
 * If validComponents is provided, also validates component type names.
 */
function validateFixtureMessages(
  content: string,
  fixtureName: string,
  messages: unknown[],
  errors: vscode.Diagnostic[],
  validComponents: Set<string> | null,
  registry: ComponentRegistry,
  fixturePath: string,
): void {
  const warn = (text: string, searchValue?: string) => {
    const { line, col, length } = findValuePosition(content, searchValue);
    errors.push(
      new vscode.Diagnostic(
        new vscode.Range(line, col, line, col + length),
        text,
        vscode.DiagnosticSeverity.Warning,
      ),
    );
  };

  let hasCreateSurface = false;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as Record<string, unknown>;

    if (!msg.version) {
      warn('Missing "version" field (expected "v0.9")', `"${fixtureName}"`);
      continue;
    }
    if (msg.version !== "v0.9") {
      warn(
        `"version" is "${msg.version}" — only "v0.9" is supported`,
        `"version": "${msg.version}"`,
      );
    }

    const types = [
      "createSurface",
      "updateComponents",
      "updateDataModel",
      "deleteSurface",
    ] as const;
    const present = types.filter((t) => t in msg);

    if (present.length === 0) {
      warn(
        "No recognized message type (expected createSurface, updateComponents, updateDataModel, or deleteSurface)",
        `"version": "v0.9"`,
      );
      continue;
    }
    if (present.length > 1) {
      warn(
        `Multiple message types (${present.join(", ")}) — each message should have exactly one`,
        `"${present[1]}"`,
      );
    }

    // --- createSurface ---
    if ("createSurface" in msg) {
      hasCreateSurface = true;
      const cs = msg.createSurface as Record<string, unknown> | null;
      if (!cs || typeof cs !== "object") {
        warn('"createSurface" must be an object', '"createSurface"');
        continue;
      }
      if (typeof cs.surfaceId !== "string" || !cs.surfaceId) {
        warn(
          '"createSurface.surfaceId" is required (non-empty string)',
          '"createSurface"',
        );
      }
      if (typeof cs.catalogId !== "string" || !cs.catalogId) {
        warn(
          '"createSurface.catalogId" is required (non-empty string)',
          '"createSurface"',
        );
      }
    }

    // --- updateComponents ---
    if ("updateComponents" in msg) {
      if (!hasCreateSurface) {
        warn(
          '"updateComponents" before "createSurface" — surface must be created first',
          '"updateComponents"',
        );
      }
      const uc = msg.updateComponents as Record<string, unknown> | null;
      if (!uc || typeof uc !== "object") {
        warn('"updateComponents" must be an object', '"updateComponents"');
        continue;
      }
      if (typeof uc.surfaceId !== "string" || !uc.surfaceId) {
        warn(
          '"updateComponents.surfaceId" is required (non-empty string)',
          '"updateComponents"',
        );
      }
      if (!Array.isArray(uc.components)) {
        warn(
          '"updateComponents.components" must be an array',
          '"updateComponents"',
        );
      } else {
        const seenIds = new Set<string>();
        for (const comp of uc.components) {
          const c = comp as Record<string, unknown>;
          if (!c || typeof c !== "object") continue;

          const compId = typeof c.id === "string" ? c.id : null;
          const compType = typeof c.component === "string" ? c.component : null;

          if (!compId) {
            warn('Component missing required "id" field', '"component"');
          } else if (seenIds.has(compId)) {
            warn(`Duplicate component id "${compId}"`, `"id": "${compId}"`);
          } else {
            seenIds.add(compId);
          }

          if (!compType) {
            warn(
              `Component "${compId ?? "?"}" missing "component" field`,
              compId ? `"id": "${compId}"` : '"components"',
            );
          } else if (validComponents && !validComponents.has(compType)) {
            warn(
              `Unknown component "${compType}" — not found in catalog. Available: ${[...validComponents].sort().join(", ")}`,
              `"component": "${compType}"`,
            );
          } else if (compType) {
            // Validate props against the component's known schema
            const knownProps = registry.getComponentProps(
              fixturePath,
              compType,
            );
            if (knownProps && knownProps.size > 0) {
              const structuralKeys = new Set(["id", "component"]);
              for (const key of Object.keys(c)) {
                if (structuralKeys.has(key)) continue;
                if (!knownProps.has(key)) {
                  // Find closest match for typo suggestion
                  const suggestion = findClosestMatch(key, knownProps);
                  const hint = suggestion
                    ? ` Did you mean "${suggestion}"?`
                    : ` Known props: ${[...knownProps].sort().join(", ")}`;
                  warn(
                    `Unknown prop "${key}" on <${compType}>.${hint}`,
                    `"${key}"`,
                  );
                }
              }
            }
          }
        }
        if (!seenIds.has("root")) {
          warn(
            'No component with id "root" — the renderer starts from "root"',
            '"components"',
          );
        }
      }
    }

    // --- updateDataModel ---
    if ("updateDataModel" in msg) {
      if (!hasCreateSurface) {
        warn('"updateDataModel" before "createSurface"', '"updateDataModel"');
      }
      const ud = msg.updateDataModel as Record<string, unknown> | null;
      if (!ud || typeof ud !== "object") {
        warn('"updateDataModel" must be an object', '"updateDataModel"');
        continue;
      }
      if (typeof ud.surfaceId !== "string" || !ud.surfaceId) {
        warn('"updateDataModel.surfaceId" is required', '"updateDataModel"');
      }
    }

    // --- deleteSurface ---
    if ("deleteSurface" in msg) {
      const ds = msg.deleteSurface as Record<string, unknown> | null;
      if (!ds || typeof ds !== "object") {
        warn('"deleteSurface" must be an object', '"deleteSurface"');
        continue;
      }
      if (typeof ds.surfaceId !== "string" || !ds.surfaceId) {
        warn('"deleteSurface.surfaceId" is required', '"deleteSurface"');
      }
    }
  }

  if (messages.length > 0 && !hasCreateSurface) {
    warn(
      `"${fixtureName}": no "createSurface" message — the first message should create the surface`,
      `"${fixtureName}"`,
    );
  }
}

/**
 * Simple Levenshtein distance for typo detection.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0),
      );
    }
  }
  return dp[m][n];
}

/**
 * Finds the closest matching string from a set, or null if nothing is close.
 */
function findClosestMatch(
  input: string,
  candidates: Set<string>,
): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  const maxDist = Math.max(2, Math.floor(input.length * 0.4));
  for (const candidate of candidates) {
    const dist = levenshtein(input.toLowerCase(), candidate.toLowerCase());
    if (dist < bestDist && dist <= maxDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

/**
 * Finds the exact line, column, and length of a string value in content.
 * Returns the position for diagnostic highlighting.
 */
function findValuePosition(
  content: string,
  searchValue?: string,
): { line: number; col: number; length: number } {
  if (!searchValue) return { line: 0, col: 0, length: 1 };

  const idx = content.indexOf(searchValue);
  if (idx === -1) return { line: 0, col: 0, length: 1 };

  // Count lines up to the match
  const before = content.slice(0, idx);
  const line = before.split("\n").length - 1;
  const lastNewline = before.lastIndexOf("\n");
  const col = idx - lastNewline - 1;

  return { line, col, length: searchValue.length };
}

function buildComponent(filePath: string): DiscoveredComponent {
  const basename = path.basename(filePath, path.extname(filePath));
  const name =
    basename === "index" ? path.basename(path.dirname(filePath)) : basename;

  const fixturePath = findFixtureFile(filePath);
  return {
    name,
    filePath,
    fixturePath,
    fixtureNames: fixturePath ? getFixtureNames(fixturePath) : undefined,
  };
}
