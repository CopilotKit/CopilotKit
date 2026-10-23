// Shown beside the onboarding prompt, never inside it: the copied prompt must
// stay byte-identical to the Intelligence app and Inspector copies.
//
// Most copied prompts are never pasted anywhere, and nothing near the button
// said where the prompt goes (PE-340). A new terminal also starts in the home
// folder, where the agent would build the starter app (PE-301). This line
// answers both.
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
