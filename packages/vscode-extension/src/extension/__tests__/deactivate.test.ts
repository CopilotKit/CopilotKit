import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  Uri: {
    joinPath: (_base: unknown, ...parts: string[]) => ({
      toString: () => parts.join("/"),
      fsPath: parts.join("/"),
    }),
    file: (p: string) => ({ fsPath: p, scheme: "file" }),
  },
  window: {
    createOutputChannel: () => ({ appendLine: vi.fn(), dispose: vi.fn() }),
    registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showQuickPick: vi.fn(),
    showInputBox: vi.fn(),
    activeTextEditor: null,
  },
  workspace: {
    workspaceFolders: [],
    onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    textDocuments: [],
    getConfiguration: vi.fn(() => ({ get: vi.fn() })),
    openTextDocument: vi.fn(),
  },
  languages: {
    createDiagnosticCollection: vi.fn(() => ({
      delete: vi.fn(),
      set: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  commands: {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  },
  TextEditorRevealType: { InCenter: 2 },
  DiagnosticSeverity: { Warning: 1 },
  Diagnostic: vi.fn(),
  Range: vi.fn(),
  Position: vi.fn(),
  Selection: vi.fn(),
}));

import { deactivate } from "../activate";

describe("deactivate", () => {
  it("is callable with no active session (no-op)", () => {
    expect(() => deactivate()).not.toThrow();
  });
});
