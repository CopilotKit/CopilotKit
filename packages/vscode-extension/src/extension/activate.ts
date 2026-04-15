import * as vscode from "vscode";
import * as path from "node:path";
import type { DiscoveredComponent } from "./types";
import { PreviewPanel } from "./preview-panel";
import { FileWatcher } from "./file-watcher";
import { ComponentPreviewProvider } from "./sidebar/view-provider";
import {
  findFixtureFile,
  getFixtureNames,
} from "./sidebar/component-scanner";
import { parseFixtureJson, validateFixture } from "./fixture-validator";
import { ComponentRegistry } from "./component-registry";

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
  );

  // Sidebar tree view
  const sidebarProvider = new ComponentPreviewProvider(workspaceRoot);
  const treeView = vscode.window.createTreeView(
    "copilotkit.componentPreview",
    {
      treeDataProvider: sidebarProvider,
      showCollapseAll: true,
    },
  );
  context.subscriptions.push(treeView);

  // Populate the registry from discovered components
  for (const comp of sidebarProvider.getComponents()) {
    registry.register(comp.filePath);
  }

  // File watcher — updates sidebar, preview, and component registry on changes
  const fileWatcher = new FileWatcher((filePath) => {
    sidebarProvider.refresh();
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
    vscode.commands.registerCommand("copilotkit.refreshComponents", () => {
      sidebarProvider.refresh();
    }),
  );
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
          validateFixtureMessages(content, name, fixture.messages, errors, validComponents);
        }
      }
      if (errors.length > 0) {
        diagnostics.set(doc.uri, errors);
      }
    } else {
      const diags = result.errors.map(
        (err) =>
          new vscode.Diagnostic(
            new vscode.Range(
              (err.line ?? 1) - 1,
              0,
              (err.line ?? 1) - 1,
              100,
            ),
            err.message,
            vscode.DiagnosticSeverity.Warning,
          ),
      );
      diagnostics.set(doc.uri, diags);
    }
  } else if (fsPath.endsWith(".fixture.ts") || fsPath.endsWith(".fixture.tsx")) {
    const result = validateFixture(fsPath, content);
    if (result.valid) {
      diagnostics.delete(doc.uri);
    } else {
      const diags = result.errors.map(
        (err) =>
          new vscode.Diagnostic(
            new vscode.Range(
              (err.line ?? 1) - 1,
              0,
              (err.line ?? 1) - 1,
              100,
            ),
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
      warn(`"version" is "${msg.version}" — only "v0.9" is supported`, `"version": "${msg.version}"`);
    }

    const types = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"] as const;
    const present = types.filter((t) => t in msg);

    if (present.length === 0) {
      warn("No recognized message type (expected createSurface, updateComponents, updateDataModel, or deleteSurface)", `"version": "v0.9"`);
      continue;
    }
    if (present.length > 1) {
      warn(`Multiple message types (${present.join(", ")}) — each message should have exactly one`, `"${present[1]}"`);
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
        warn('"createSurface.surfaceId" is required (non-empty string)', '"createSurface"');
      }
      if (typeof cs.catalogId !== "string" || !cs.catalogId) {
        warn('"createSurface.catalogId" is required (non-empty string)', '"createSurface"');
      }
    }

    // --- updateComponents ---
    if ("updateComponents" in msg) {
      if (!hasCreateSurface) {
        warn('"updateComponents" before "createSurface" — surface must be created first', '"updateComponents"');
      }
      const uc = msg.updateComponents as Record<string, unknown> | null;
      if (!uc || typeof uc !== "object") {
        warn('"updateComponents" must be an object', '"updateComponents"');
        continue;
      }
      if (typeof uc.surfaceId !== "string" || !uc.surfaceId) {
        warn('"updateComponents.surfaceId" is required (non-empty string)', '"updateComponents"');
      }
      if (!Array.isArray(uc.components)) {
        warn('"updateComponents.components" must be an array', '"updateComponents"');
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
            warn(`Component "${compId ?? "?"}" missing "component" field`, compId ? `"id": "${compId}"` : '"components"');
          } else if (validComponents && !validComponents.has(compType)) {
            warn(
              `Unknown component "${compType}" — not found in catalog. Available: ${[...validComponents].sort().join(", ")}`,
              `"component": "${compType}"`,
            );
          }
        }
        if (!seenIds.has("root")) {
          warn('No component with id "root" — the renderer starts from "root"', '"components"');
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
    warn(`"${fixtureName}": no "createSurface" message — the first message should create the surface`, `"${fixtureName}"`);
  }
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
