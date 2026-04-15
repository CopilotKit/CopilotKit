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

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // Diagnostics collection for fixture validation
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("copilotkit");
  context.subscriptions.push(diagnosticCollection);

  // Live fixture validation — runs on every change to .fixture.* files
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const fsPath = event.document.uri.fsPath;
      if (!fsPath.includes(".fixture.")) return;
      validateFixtureDocument(event.document, diagnosticCollection);
    }),
  );

  // Also validate when a fixture file is opened
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (!doc.uri.fsPath.includes(".fixture.")) return;
      validateFixtureDocument(doc, diagnosticCollection);
    }),
  );

  // Validate any already-open fixture files
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.fsPath.includes(".fixture.")) {
      validateFixtureDocument(doc, diagnosticCollection);
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

  // File watcher
  const fileWatcher = new FileWatcher((filePath) => {
    sidebarProvider.refresh();
    previewPanel.handleFileChange(filePath);
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
): void {
  const fsPath = doc.uri.fsPath;
  const content = doc.getText();

  if (fsPath.endsWith(".fixture.json")) {
    const result = parseFixtureJson(content);
    if (result.valid) {
      diagnostics.delete(doc.uri);

      // Validate each fixture's messages have the v0.9 structure
      const deepErrors: vscode.Diagnostic[] = [];
      if (result.fixtures) {
        for (const [name, fixture] of Object.entries(result.fixtures)) {
          if (fixture.messages.length === 0) continue;
          // Check that messages have version field
          for (let i = 0; i < fixture.messages.length; i++) {
            const msg = fixture.messages[i] as Record<string, unknown>;
            if (!msg.version) {
              const line = findLineForFixture(content, name, i);
              deepErrors.push(
                new vscode.Diagnostic(
                  new vscode.Range(line, 0, line, 100),
                  `Fixture "${name}" message ${i}: missing "version" field (expected "v0.9")`,
                  vscode.DiagnosticSeverity.Warning,
                ),
              );
            }
            // Check for known message types
            const hasKnownType =
              "createSurface" in msg ||
              "updateComponents" in msg ||
              "updateDataModel" in msg ||
              "deleteSurface" in msg;
            if (msg.version && !hasKnownType) {
              const line = findLineForFixture(content, name, i);
              deepErrors.push(
                new vscode.Diagnostic(
                  new vscode.Range(line, 0, line, 100),
                  `Fixture "${name}" message ${i}: no recognized A2UI v0.9 message type (expected createSurface, updateComponents, updateDataModel, or deleteSurface)`,
                  vscode.DiagnosticSeverity.Warning,
                ),
              );
            }
          }
        }
      }
      if (deepErrors.length > 0) {
        diagnostics.set(doc.uri, deepErrors);
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
 * Best-effort line number finder for a fixture message in JSON.
 */
function findLineForFixture(
  content: string,
  fixtureName: string,
  messageIndex: number,
): number {
  const lines = content.split("\n");
  let inFixture = false;
  let messageCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`"${fixtureName}"`)) {
      inFixture = true;
    }
    if (inFixture && lines[i].includes('"version"')) {
      if (messageCount === messageIndex) return i;
      messageCount++;
    }
    // Heuristic: opening brace of a message object in the messages array
    if (inFixture && messageCount <= messageIndex && lines[i].trim() === "{") {
      if (messageCount === messageIndex) return i;
    }
  }
  return 0;
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
