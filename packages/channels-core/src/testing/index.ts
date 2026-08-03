/**
 * Test doubles shared across the channels packages. Adapter packages
 * (`channels-slack`, `channels-teams`, …) import these to drive a real
 * `createChannel` runtime end-to-end — render → interaction → dispatch —
 * without standing up a platform.
 *
 * This entrypoint requires `vitest` to be installed: the conformance suite
 * below imports it eagerly. That matches the package's optional `vitest` peer
 * dependency — the subpath is only ever consumed from a test environment.
 */
export { FakeAdapter, makeFakeRunRenderer } from "./fake-adapter.js";
export { FakeAgent } from "./fake-agent.js";
export type { FakeAgentScriptStep } from "./fake-agent.js";
export { runStateStoreConformance } from "./state-store-conformance.js";
