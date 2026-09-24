import { expect, it } from "vitest";
import {
  PROMPT_DESTINATION_HINT,
  PROMPT_LAUNCH_NOTE,
  PROMPT_PHONE_HINT,
} from "../prompt-guidance";

// The same words appear beside the prompt in the Intelligence app and on
// copilotkit.ai, which cannot import this module. Pinning the text here makes
// a change to it a deliberate edit that the other two copies must follow.
it("pins the line shown beside every prompt Copy button", () => {
  expect(PROMPT_DESTINATION_HINT).toBe(
    "Paste it into a coding agent such as Claude Code, Codex or Cursor. Open the agent in your project's folder, or in an empty folder for a new app.",
  );
  expect(PROMPT_PHONE_HINT).toBe(
    "This prompt runs in a coding agent on the computer with your project.",
  );
  expect(PROMPT_LAUNCH_NOTE).toBe(
    "Nothing opened? The prompt is copied. Paste it into your coding agent.",
  );
});
