import * as vscode from "vscode";
import * as path from "node:path";
import type { DiscoveredComponent } from "./types";
import { PreviewPanel } from "./preview-panel";
import { FileWatcher } from "./file-watcher";
import { ComponentPreviewProvider } from "./sidebar/view-provider";
import { findFixtureFile, getFixtureNames } from "./sidebar/component-scanner";

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // Diagnostics collection for fixture validation
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("copilotkit");
  context.subscriptions.push(diagnosticCollection);

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
