// Shown beside the onboarding prompt, never inside it: the copied prompt must
// stay byte-identical to the Intelligence app and Inspector copies.
//
// Most copied prompts are never pasted anywhere, and nothing near the button
// said where the prompt goes (PE-340). A new terminal and the Claude Code and
// Codex app links also start in the home folder, where the agent would build
// the starter app (PE-301). This line answers both.
//
// The Intelligence app and copilotkit.ai show the same words and cannot import
// this module. Change all three together.
export const PROMPT_DESTINATION_HINT =
  "Paste it into a coding agent such as Claude Code, Codex or Cursor. Open the agent in your project's folder, or in an empty folder for a new app.";

// On a phone the prompt has nowhere to go: it runs in a coding agent on the
// computer that holds the project. 46 phone run ids copied in two days led to
// 1 run (PE-339).
export const PROMPT_PHONE_HINT =
  "This prompt runs in a coding agent on the computer with your project.";

// Shown after an "Open in Claude Code" or "Open in Codex" click. When no app
// handles the link, the click does nothing visible, and a lab check found no
// signal that tells that case apart from an app that opened (PE-337). The app
// click also copies the prompt, so the note can say it is on the clipboard.
export const PROMPT_LAUNCH_NOTE =
  "Nothing opened? The prompt is copied. Paste it into your coding agent.";
