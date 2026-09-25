// Same shape as tiny-headless.js plus one construct esbuild warns about
// (a duplicate object key). Used to prove measureHeadlessBundle RETURNS
// esbuild's warnings rather than dropping them on the floor — `logLevel:
// "silent"` stops esbuild printing them, so the script must surface them.
export const CopilotKitProvider = () => null;
export const useAgent = () => null;
export const useFrontendTool = () => null;
export const useRenderTool = () => null;
export const useRenderToolCall = () => null;
// The duplicate key is the POINT of this fixture — it is what makes esbuild
// emit a warning. Silence the linter rather than the test's subject.
// oxlint-disable-next-line no-dupe-keys
export const useComponent = () => ({ duplicated: 1, duplicated: 2 });
