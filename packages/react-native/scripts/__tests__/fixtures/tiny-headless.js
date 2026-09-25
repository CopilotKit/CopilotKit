// Minimal stand-in for @copilotkit/react-native/headless, used by
// measure-headless.test.mjs. It exports exactly the symbols the measurement
// imports, so the bundling pipeline can be exercised without depending on the
// package's built dist.
export const CopilotKitProvider = () => null;
export const useAgent = () => null;
export const useFrontendTool = () => null;
export const useRenderTool = () => null;
export const useRenderToolCall = () => null;
export const useComponent = () => null;
