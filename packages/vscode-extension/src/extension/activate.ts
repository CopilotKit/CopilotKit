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

      const errors: vscode.Diagnostic[] = [];
      if (result.fixtures) {
        for (const [name, fixture] of Object.entries(result.fixtures)) {
          validateFixtureMessages(content, name, fixture.messages, errors);
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
 */
function validateFixtureMessages(
  content: string,
  fixtureName: string,
  messages: unknown[],
  errors: vscode.Diagnostic[],
): void {
  const warn = (msgIdx: number, text: string, key?: string) => {
    const line = findKeyLine(content, fixtureName, msgIdx, key);
    errors.push(
      new vscode.Diagnostic(
        new vscode.Range(line, 0, line, 200),
        `"${fixtureName}" message[${msgIdx}]: ${text}`,
        vscode.DiagnosticSeverity.Warning,
      ),
    );
  };

  let hasCreateSurface = false;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as Record<string, unknown>;

    // version field
    if (!msg.version) {
      warn(i, 'missing "version" field (expected "v0.9")');
      continue;
    }
    if (msg.version !== "v0.9") {
      warn(i, `"version" is "${msg.version}" — only "v0.9" is supported`, "version");
    }

    // Count message types present
    const types = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"] as const;
    const present = types.filter((t) => t in msg);

    if (present.length === 0) {
      warn(i, "no recognized message type (expected createSurface, updateComponents, updateDataModel, or deleteSurface)");
      continue;
    }
    if (present.length > 1) {
      warn(i, `multiple message types in one message (${present.join(", ")}) — each message should have exactly one`);
    }

    // --- createSurface ---
    if ("createSurface" in msg) {
      hasCreateSurface = true;
      const cs = msg.createSurface as Record<string, unknown> | null;
      if (!cs || typeof cs !== "object") {
        warn(i, '"createSurface" must be an object', "createSurface");
        continue;
      }
      if (typeof cs.surfaceId !== "string" || !cs.surfaceId) {
        warn(i, '"createSurface.surfaceId" is required and must be a non-empty string', "surfaceId");
      }
      if (typeof cs.catalogId !== "string" || !cs.catalogId) {
        warn(i, '"createSurface.catalogId" is required and must be a non-empty string', "catalogId");
      }
    }

    // --- updateComponents ---
    if ("updateComponents" in msg) {
      if (!hasCreateSurface) {
        warn(i, '"updateComponents" sent before "createSurface" — surface must be created first');
      }
      const uc = msg.updateComponents as Record<string, unknown> | null;
      if (!uc || typeof uc !== "object") {
        warn(i, '"updateComponents" must be an object', "updateComponents");
        continue;
      }
      if (typeof uc.surfaceId !== "string" || !uc.surfaceId) {
        warn(i, '"updateComponents.surfaceId" is required and must be a non-empty string', "surfaceId");
      }
      if (!Array.isArray(uc.components)) {
        warn(i, '"updateComponents.components" is required and must be an array', "components");
      } else {
        // Validate each component
        const seenIds = new Set<string>();
        for (let c = 0; c < uc.components.length; c++) {
          const comp = uc.components[c] as Record<string, unknown>;
          if (!comp || typeof comp !== "object") {
            warn(i, `components[${c}] must be an object`, "components");
            continue;
          }
          if (typeof comp.id !== "string" || !comp.id) {
            warn(i, `components[${c}] missing required "id" field`, "components");
          } else {
            if (seenIds.has(comp.id)) {
              warn(i, `components[${c}] duplicate id "${comp.id}" — each component must have a unique id`, "components");
            }
            seenIds.add(comp.id);
          }
          if (typeof comp.component !== "string" || !comp.component) {
            warn(i, `components[${c}] (id: "${comp.id ?? "?"}") missing required "component" field — must specify the component type`, "components");
          }
        }
        // Check that a "root" component exists
        if (!seenIds.has("root")) {
          warn(i, 'no component with id "root" — the surface renderer starts from the "root" component', "components");
        }
      }
    }

    // --- updateDataModel ---
    if ("updateDataModel" in msg) {
      if (!hasCreateSurface) {
        warn(i, '"updateDataModel" sent before "createSurface" — surface must be created first');
      }
      const ud = msg.updateDataModel as Record<string, unknown> | null;
      if (!ud || typeof ud !== "object") {
        warn(i, '"updateDataModel" must be an object', "updateDataModel");
        continue;
      }
      if (typeof ud.surfaceId !== "string" || !ud.surfaceId) {
        warn(i, '"updateDataModel.surfaceId" is required', "surfaceId");
      }
    }

    // --- deleteSurface ---
    if ("deleteSurface" in msg) {
      const ds = msg.deleteSurface as Record<string, unknown> | null;
      if (!ds || typeof ds !== "object") {
        warn(i, '"deleteSurface" must be an object', "deleteSurface");
        continue;
      }
      if (typeof ds.surfaceId !== "string" || !ds.surfaceId) {
        warn(i, '"deleteSurface.surfaceId" is required', "surfaceId");
      }
    }
  }

  // Cross-message checks
  if (messages.length > 0 && !hasCreateSurface) {
    const line = findKeyLine(content, fixtureName, 0);
    errors.push(
      new vscode.Diagnostic(
        new vscode.Range(line, 0, line, 200),
        `"${fixtureName}": no "createSurface" message found — the first message should create the surface`,
        vscode.DiagnosticSeverity.Warning,
      ),
    );
  }
}

/**
 * Best-effort line finder for a key within a fixture's message in JSON.
 */
function findKeyLine(
  content: string,
  fixtureName: string,
  messageIndex: number,
  key?: string,
): number {
  const lines = content.split("\n");
  let inFixture = false;
  let braceDepth = 0;
  let messagesSeen = -1;
  let messageStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (!inFixture && lines[i].includes(`"${fixtureName}"`)) {
      inFixture = true;
      continue;
    }
    if (!inFixture) continue;

    // Track message boundaries within the "messages" array
    if (trimmed.includes('"messages"')) {
      messagesSeen = -1;
    }

    // Count opening braces as potential message starts
    if (trimmed === "{" || trimmed.startsWith('{"') || trimmed.startsWith("{ ")) {
      braceDepth++;
      if (braceDepth === 3) {
        // depth 1=fixture, 2=messages array content, 3=individual message
        messagesSeen++;
        messageStartLine = i;
      }
    }
    if (trimmed.includes("}")) {
      braceDepth = Math.max(0, braceDepth - (trimmed.split("}").length - 1));
    }

    if (messagesSeen === messageIndex) {
      if (key && lines[i].includes(`"${key}"`)) {
        return i;
      }
      if (!key) return messageStartLine;
    }

    // Stop if we've left this fixture
    if (inFixture && braceDepth === 0 && messagesSeen >= 0) break;
  }

  return messageStartLine || 0;
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
