/**
 * Test doubles shared across the channels packages. Adapter packages
 * (`channels-slack`, `channels-teams`, …) import these to drive a real
 * `createChannel` runtime end-to-end — render → interaction → dispatch —
 * without standing up a platform.
 */
export { FakeAdapter, makeFakeRunRenderer } from "./fake-adapter.js";
export { FakeAgent } from "./fake-agent.js";
export type { FakeAgentScriptStep } from "./fake-agent.js";
export { runStateStoreConformance } from "./state-store-conformance.js";
