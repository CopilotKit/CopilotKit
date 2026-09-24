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
    "Paste into a coding agent running in your project folder.",
  );
  expect(PROMPT_PHONE_HINT).toBe(
    "This runs in a coding agent on your computer.",
  );
  expect(PROMPT_LAUNCH_NOTE).toBe(
    "Nothing opened? Paste the copied prompt into your coding agent.",
  );
});
