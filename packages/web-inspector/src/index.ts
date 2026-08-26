/**
 * Public entry point for the web inspector.
 *
 * Keep this file declarative: it is the package's public interface and
 * registration surface, not an implementation module. See `README.md` for
 * the internal source map.
 */
export {
  defineWebInspector,
  THREAD_INSPECTOR_TAG,
  WEB_INSPECTOR_TAG,
  WebInspectorElement,
} from "./inspector-elements.js";
export type { InspectorOpenOptions } from "./inspector-elements.js";

export {
  CpkThreadInspector,
  ɵCpkThreadDetails,
} from "./components/thread-inspector.js";
export type {
  ThreadDebuggerEvent,
  ThreadDebuggerMessage,
  ThreadDebuggerMetadata,
  ThreadDebuggerProvider,
  ThreadDebuggerProviderLoadOptions,
  ThreadDebuggerToolCall,
} from "./lib/thread-debugger.js";

export { buildCapabilityRows as ɵbuildCapabilityRows } from "./lib/capabilities.js";
export type { CapabilityToolRow as ɵCapabilityToolRow } from "./lib/capabilities.js";
export type { Anchor } from "./lib/types.js";
export {
  maxRecallScore as ɵmaxRecallScore,
  normalizeRelevance as ɵnormalizeRelevance,
  relevanceBarWidth as ɵrelevanceBarWidth,
} from "./lib/memory-recall.js";
