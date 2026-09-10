import { afterEach, expect, it, vi } from "vitest";
import { launchPrompt } from "../launch-prompt";
afterEach(() => vi.unstubAllGlobals());
it.each([
  ["claude", "claude-cli://open?q="],
  ["codex", "codex://new?prompt="],
] as const)("encodes the complete prompt for %s", (app, prefix) => {
  const location = { href: "" };
  vi.stubGlobal("window", { location });
  const prompt = "Inspect CLAUDE.md & AGENTS.md\nü? #+";
  launchPrompt(app, prompt);
  expect(location.href).toBe(prefix + encodeURIComponent(prompt));
});
