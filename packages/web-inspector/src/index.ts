export type { Anchor } from "./shell/contracts.js";
export type {
  ThreadDebuggerEvent,
  ThreadDebuggerMessage,
  ThreadDebuggerMetadata,
  ThreadDebuggerProvider,
  ThreadDebuggerProviderLoadOptions,
  ThreadDebuggerToolCall,
} from "./shared/thread-debugger/types.js";

export {
  CpkThreadInspector,
  ɵCpkThreadDetails,
} from "./domains/threads/detail/thread-inspector.js";
export { buildCapabilityRows as ɵbuildCapabilityRows } from "./domains/live-inspection/capabilities/model.js";
export type { CapabilityToolRow as ɵCapabilityToolRow } from "./domains/live-inspection/capabilities/model.js";
export {
  maxRecallScore as ɵmaxRecallScore,
  normalizeRelevance as ɵnormalizeRelevance,
  relevanceBarWidth as ɵrelevanceBarWidth,
} from "./domains/learning/recall.js";

export type { InspectorOpenOptions } from "./shell/web-inspector-element.js";
export { WebInspectorElement } from "./shell/web-inspector-element.js";
export {
  configureWebInspectorElement,
  defineWebInspector,
  THREAD_INSPECTOR_TAG,
  WEB_INSPECTOR_TAG,
} from "./register.js";

import { defineWebInspector } from "./register.js";

defineWebInspector();
