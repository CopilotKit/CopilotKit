import * as vscode from "vscode";

export interface ModelPickerOptions {
  /** From the `copilotkit.playground.model` setting. Empty string treated as unset. */
  preferredId?: string;
}

/**
 * Returns the user's preferred chat model when one matches by id (then family),
 * the first available model when no preference is set, or null when VS Code
 * reports no models at all (no Copilot subscription, no other LM-provider extension).
 */
export async function pickModel(
  opts: ModelPickerOptions = {},
): Promise<vscode.LanguageModelChat | null> {
  const all = await vscode.lm.selectChatModels({});
  if (all.length === 0) return null;
  const wanted = opts.preferredId?.trim();
  if (wanted) {
    const byId = all.find((m) => m.id === wanted);
    if (byId) return byId;
    const byFamily = all.find((m) => m.family === wanted);
    if (byFamily) return byFamily;
  }
  return all[0];
}

export async function listModels(): Promise<vscode.LanguageModelChat[]> {
  return vscode.lm.selectChatModels({});
}
