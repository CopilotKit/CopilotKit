export type PromptApp = "claude" | "codex";

/** Ask the operating system to open its registered native app synchronously. */
export function launchPrompt(app: PromptApp, prompt: string): void {
  window.location.href =
    app === "claude"
      ? `claude-cli://open?q=${encodeURIComponent(prompt)}`
      : `codex://new?prompt=${encodeURIComponent(prompt)}`;
}
