// Minimal fixture used by measure-copilotchat.test.mjs. The function under test
// bundles `export { CopilotChat } from "<entryModule>"`, so this exports a
// trivial CopilotChat symbol to validate the script's bundling pipeline without
// depending on react-core's built dist.
export const CopilotChat = () => null;
