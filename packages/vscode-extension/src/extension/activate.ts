import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  const previewCommand = vscode.commands.registerCommand(
    "copilotkit.previewComponent",
    () => {
      vscode.window.showInformationMessage(
        "CopilotKit: Preview Component (not yet implemented)",
      );
    },
  );

  const explorerCommand = vscode.commands.registerCommand(
    "copilotkit.previewComponentFromExplorer",
    (uri: vscode.Uri) => {
      vscode.window.showInformationMessage(
        `CopilotKit: Preview ${uri.fsPath} (not yet implemented)`,
      );
    },
  );

  const refreshCommand = vscode.commands.registerCommand(
    "copilotkit.refreshComponents",
    () => {
      vscode.window.showInformationMessage(
        "CopilotKit: Refresh (not yet implemented)",
      );
    },
  );

  context.subscriptions.push(previewCommand, explorerCommand, refreshCommand);
}

export function deactivate(): void {}
