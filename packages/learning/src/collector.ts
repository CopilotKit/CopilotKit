import { installClickCapture } from "./clicks";
import { installNavigationCapture } from "./navigation";
import { installNetworkCapture } from "./network";
import { toRoute } from "./routes";
import { BUILT_IN_EVENT_NAMES } from "./types";
import type {
  BuiltInEventName,
  Collector,
  CollectorOptions,
  LearningBatch,
  LearningEvent,
  SinkSendOptions,
  StartOptions,
} from "./types";

// ponytail: flushing at 50 also bounds the queue at 50; add a separate cap only if sends become async-buffered.
const FLUSH_SIZE = 50;
const FLUSH_INTERVAL_MS = 2000;
const BUILT_IN = new Set<string>(BUILT_IN_EVENT_NAMES);

interface Session {
  trajectoryId: string;
  learningContainerIds: string[] | undefined;
  seq: number;
  queue: LearningEvent[];
  dropped: number;
  uninstalls: (() => void)[];
  timer: ReturnType<typeof setInterval> | undefined;
}

/**
 * Creates a collector. Nothing is installed until `start()`: no listeners,
 * no patches, no timers, no buffer. `stop()` removes all of them and sends
 * queued events once, without retries.
 *
 * @example
 * const collector = createCollector({ sink: httpSink("/api/learning-events") });
 * collector.start({ trajectoryId: crypto.randomUUID() });
 */
export function createCollector(options: CollectorOptions) {
  const { sink, routes, beforeSend, enrich } = options;
  const capture = {
    clicks: true,
    navigation: true,
    network: true,
    ...options.capture,
  };
  let session: Session | null = null;

  const getRoute = () => toRoute(location.pathname, routes);

  const flush = (sendOptions?: SinkSendOptions) => {
    const current = session;
    if (current === null) return;
    if (current.queue.length === 0 && current.dropped === 0) return;
    const events = current.queue.splice(0);
    const dropped = current.dropped;
    current.dropped = 0;
    const batch: LearningBatch = {
      trajectoryId: current.trajectoryId,
      learningContainerIds: current.learningContainerIds,
      events,
      dropped,
    };
    const onFailure = () => {
      // No retry: report the loss in the next batch instead.
      if (session === current) current.dropped += events.length + dropped;
    };
    try {
      Promise.resolve(sink(batch, sendOptions)).catch(onFailure);
    } catch {
      onFailure();
    }
  };

  const record = (name: string, value: Record<string, unknown>) => {
    const current = session;
    if (current === null) return;
    try {
      current.seq += 1;
      const event: LearningEvent = {
        type: "CUSTOM",
        name,
        value: { ...value, seq: current.seq },
        timestamp: Date.now(),
      };
      const kept = beforeSend === undefined ? event : beforeSend(event);
      if (kept === null) return;
      current.queue.push(kept);
      if (current.queue.length >= FLUSH_SIZE) flush();
    } catch {
      // Capture must never break the host app.
    }
  };

  const start = ({ trajectoryId, learningContainerIds }: StartOptions) => {
    if (session !== null) {
      if (session.trajectoryId !== trajectoryId) {
        console.warn(
          `[@copilotkit/learning] Trajectory "${session.trajectoryId}" is active. Stop it before you start "${trajectoryId}".`,
        );
      }
      return;
    }
    if (typeof window === "undefined") return;
    const current: Session = {
      trajectoryId,
      learningContainerIds,
      seq: 0,
      queue: [],
      dropped: 0,
      uninstalls: [],
      timer: undefined,
    };
    session = current;
    const ignoreUrls = [
      ...(options.ignoreUrls ?? []),
      ...(sink.url === undefined ? [] : [sink.url]),
    ];
    if (capture.clicks)
      current.uninstalls.push(
        installClickCapture({ emit: record, getRoute, enrich }),
      );
    if (capture.navigation)
      current.uninstalls.push(
        installNavigationCapture({ emit: record, routes }),
      );
    if (capture.network)
      current.uninstalls.push(
        installNetworkCapture({ emit: record, routes, ignoreUrls }),
      );
    const onPageHide = () => flush({ beacon: true });
    window.addEventListener("pagehide", onPageHide);
    current.uninstalls.push(() =>
      window.removeEventListener("pagehide", onPageHide),
    );
    current.timer = setInterval(() => flush(), FLUSH_INTERVAL_MS);
    record("page", { route: getRoute() });
  };

  const stop = () => {
    const current = session;
    if (current === null) return;
    clearInterval(current.timer);
    for (const uninstall of current.uninstalls) uninstall();
    flush();
    session = null;
  };

  const emit = (name: string, value: Record<string, unknown>) => {
    if (BUILT_IN.has(name)) {
      console.warn(
        `[@copilotkit/learning] "${name}" is a built-in event name. Use your own name, such as "deal.approved".`,
      );
      return;
    }
    record(name, value);
  };

  const ɵemit = (name: BuiltInEventName, value: Record<string, unknown>) =>
    record(name, value);

  const collector: Collector = {
    start,
    stop,
    emit,
    ɵemit,
    get trajectoryId() {
      return session?.trajectoryId ?? null;
    },
  };
  return collector;
}
