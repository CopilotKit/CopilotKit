/** Event names the collector and CopilotKit Core emit. `emit()` rejects them. */
export const BUILT_IN_EVENT_NAMES = [
  "page",
  "navigation",
  "click",
  "input",
  "network",
  "thread.linked",
  "agent.run",
  "agent.message",
  "tool.call",
] as const;

export type BuiltInEventName = (typeof BUILT_IN_EVENT_NAMES)[number];

/** Replaces values that never leave the browser, even with full capture: passwords and credentials. */
export const REDACTED = "[redacted]";

/** One captured interaction, shaped as an AG-UI `CUSTOM` event. */
export interface LearningEvent<V = Record<string, unknown>> {
  type: "CUSTOM";
  name: string;
  value: V;
  timestamp: number;
}

/** What a sink receives. The Trajectory scope sits on the batch, not on each event. */
export interface LearningBatch {
  trajectoryId: string;
  learningContainerIds?: string[];
  events: LearningEvent[];
  /** Events lost since the previous batch (queue overflow or a failed send). */
  dropped: number;
}

export interface SinkSendOptions {
  /** True when the page is going away; use a transport that survives unload. */
  beacon?: boolean;
}

/** Receives batches. `url`, when set, is never captured as a network event. */
export type LearningSink = ((
  batch: LearningBatch,
  options?: SinkSendOptions,
) => void | Promise<void>) & { readonly url?: string };

export interface ClickTarget {
  tag: string;
  role: string | null;
  action: string | null;
  text: string;
  attributes: Record<string, string>;
  value?: string;
  checked?: boolean;
  selectedValues?: string[];
  files?: { name: string; type: string; size: number; lastModified: number }[];
  input: "pointer" | "keyboard";
}

/** Adds fields to a click event, from the element the user clicked. */
export type EnrichFn = (target: Element) => Record<string, unknown> | undefined;

export type Emit = (name: string, value: Record<string, unknown>) => void;

export interface CaptureOptions {
  clicks?: boolean;
  navigation?: boolean;
  network?: boolean;
  inputs?: boolean;
}

export interface CollectorOptions {
  sink: LearningSink;
  /** @deprecated Capture retains raw URLs; route templates no longer transform events. */
  routes?: string[];
  /** URLs (prefix match on the absolute URL) or patterns that network capture skips. */
  ignoreUrls?: (string | RegExp)[];
  /** Turns capture modules on or off. All are on by default. */
  capture?: CaptureOptions;
  /** Runs last, in the browser. Return the event to send, or `null` to drop it. */
  beforeSend?: (event: LearningEvent) => LearningEvent | null;
  enrich?: EnrichFn;
}

export interface StartOptions {
  trajectoryId: string;
  learningContainerIds?: string[];
}

export interface Collector {
  start(options: StartOptions): void;
  stop(): void;
  /** Developer events. Built-in names warn and are ignored. */
  emit(name: string, value: Record<string, unknown>): void;
  /** @internal For @copilotkit/core only: emits built-in names. */
  ɵemit(name: BuiltInEventName, value: Record<string, unknown>): void;
  readonly trajectoryId: string | null;
}
