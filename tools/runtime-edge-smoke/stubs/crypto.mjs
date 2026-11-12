// Bare `crypto` imports left in dependencies, each with an open fix:
// - @ag-ui/a2ui-middleware, @ag-ui/mcp-apps-middleware: upstream ag-ui PRs
// - @copilotkit/license-verifier: Web Crypto `/web` entry (Intelligence repo)
// The runtime's own code imports no `crypto`; run.mjs checks its dist for that.
export const randomUUID = () => globalThis.crypto.randomUUID();
export function createHash() {
  throw new Error("node:crypto createHash is stubbed in the edge smoke test");
}
export function createPublicKey() {
  throw new Error(
    "node:crypto createPublicKey is stubbed in the edge smoke test",
  );
}
export function verify() {
  throw new Error("node:crypto verify is stubbed in the edge smoke test");
}
