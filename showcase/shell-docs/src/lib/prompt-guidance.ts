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
  "Open your coding agent in your project's folder, or in an empty folder for a new app.";

// On a phone the prompt has nowhere to go: it runs in a coding agent on the
// computer that holds the project. 46 phone run ids copied in two days led to
// 1 run (PE-339).
export const PROMPT_PHONE_HINT =
  "This runs in a coding agent on your computer.";

// Shown after an "Open in Claude Code" or "Open in Codex" click. When no app
// handles the link, the click does nothing visible, and a lab check found no
// signal that tells that case apart from an app that opened (PE-337). The app
// click also copies the prompt, so the note can say it is on the clipboard.
export const PROMPT_LAUNCH_NOTE =
  "Nothing opened? Paste the copied prompt into your coding agent.";

// How long the note stays. On the docs and the site it also holds the hover
// shelf open, and the shelf covers the content under the pill. When the app
// did open, the developer comes back to a page that must not still be covered.
export const PROMPT_LAUNCH_NOTE_MS = 15_000;
