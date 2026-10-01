export { createCollector } from "./collector";
export { httpSink } from "./http-sink";
export { toOriginAndRoute, toRoute } from "./routes";
export { BUILT_IN_EVENT_NAMES } from "./types";
export type {
  BuiltInEventName,
  CaptureOptions,
  ClickTarget,
  Collector,
  CollectorOptions,
  EnrichFn,
  LearningBatch,
  LearningEvent,
  LearningSink,
  SinkSendOptions,
  StartOptions,
} from "./types";
