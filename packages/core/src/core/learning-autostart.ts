import { randomUUID } from "@copilotkit/shared";
import type { CopilotKitCore } from "./core";
import type { ɵCopilotKitLearningOptions } from "./provider-config";

// `learning: true` uses the default authenticated capture options. One shared
// object keeps the config stable across renders.
const DEFAULT_LEARNING: ɵCopilotKitLearningOptions = Object.freeze({});

const CONTAINER_IDS_WARNING =
  "[CopilotKit] learningContainerIds is supported only with a custom sink. Authenticated Trajectory capture ignores it; assign Learning Spaces on the server with getTrajectoryLearningContainerIds on CopilotKitIntelligence, and remove learningContainerIds from the capture options.";
const IGNORED_TRAJECTORY_ID_WARNING =
  "[CopilotKit] learning.trajectoryId is ignored when autoStart is false; pass the ID to startTrajectory() instead.";
const START_FAILED_WARNING =
  "[CopilotKit] Failed to start interaction capture.";

/**
 * Turns a provider's `learning` option into the config core receives: `true`
 * is the default options, `false` or `undefined` turns capture off, and
 * `autoStart` (provider-only) is removed.
 *
 * @internal Framework adapters use this function. Applications must not depend on it.
 */
export function ɵtoLearningConfig(
  learning: boolean | ɵCopilotKitLearningOptions | undefined,
) {
  if (learning === true) return DEFAULT_LEARNING;
  if (learning === false || learning === undefined) return undefined;
  const { autoStart: _autoStart, ...config } = learning;
  return config;
}

const UNSET = Symbol("unset");

/**
 * Applies a provider's `learning` option to `core` and starts and stops the
 * provider's Trajectory, so every framework provider behaves the same.
 *
 * - Every new option value goes to `core.setLearningConfig`.
 * - With auto-start, a Trajectory starts with the supplied `trajectoryId`, or
 *   with a generated one. The generated ID survives option changes that keep
 *   generating, and `dispose()` followed by `update()` (React StrictMode
 *   replays, a remount of the same provider) restarts with the same ID.
 *   Turning capture off, setting `autoStart: false` or supplying an ID drops it.
 * - Capture stops on `dispose()` and when the start settings change,
 *   including a Trajectory the app started itself.
 * - A late rejection from an earlier start is not reported after a newer
 *   start or a stop.
 *
 * Adapters create one starter per provider, call `update()` after mount and
 * whenever the option changes, and `dispose()` on unmount.
 *
 * @example
 * const starter = new ɵLearningAutoStarter(core);
 * starter.update(props.learning);
 * starter.dispose();
 *
 * @internal Framework adapters use this class. Applications must not depend on it.
 */
export class ɵLearningAutoStarter {
  readonly #core: CopilotKitCore;
  #prop: boolean | ɵCopilotKitLearningOptions | undefined | typeof UNSET =
    UNSET;
  #config: ReturnType<typeof ɵtoLearningConfig>;
  #autoStart = false;
  #generatedTrajectoryId: string | undefined;
  #startKey: string | null = null;
  #activeStart: { stopped: boolean } | null = null;
  #warnedContainerIds = false;
  #warnedIgnoredTrajectoryId = false;

  constructor(core: CopilotKitCore) {
    this.#core = core;
  }

  /** Applies the latest `learning` option. Repeating the same value is a no-op. */
  update(learning: boolean | ɵCopilotKitLearningOptions | undefined) {
    const config =
      learning === this.#prop ? this.#config : ɵtoLearningConfig(learning);
    const enabled = config !== undefined;
    // `true` is the options-free form, so only an object can opt out.
    const autoStart =
      enabled && (typeof learning !== "object" || learning.autoStart !== false);

    const settingsChanged =
      learning !== this.#prop || autoStart !== this.#autoStart;
    this.#prop = learning;
    this.#config = config;
    this.#autoStart = autoStart;
    if (settingsChanged) {
      this.#core.setLearningConfig(config);
      this.#warnOnce(config, autoStart);
    }

    const suppliedTrajectoryId = autoStart ? config?.trajectoryId : undefined;
    const generatesTrajectoryId =
      autoStart && suppliedTrajectoryId === undefined;
    const startKey = JSON.stringify([
      enabled,
      generatesTrajectoryId,
      suppliedTrajectoryId ?? null,
    ]);
    if (startKey === this.#startKey) return;
    this.#startKey = startKey;

    this.#stop();
    // Leaving generation ends its Trajectory; generating again starts a new one.
    if (!generatesTrajectoryId) this.#generatedTrajectoryId = undefined;
    if (!enabled) return;

    const start = { stopped: false };
    this.#activeStart = start;
    const trajectoryId = generatesTrajectoryId
      ? (this.#generatedTrajectoryId ??= randomUUID())
      : suppliedTrajectoryId;
    if (trajectoryId === undefined) return;
    this.#core
      .startTrajectory({
        trajectoryId,
        learningContainerIds: config?.learningContainerIds,
      })
      .catch(() => {
        // Expected authentication/connection failures resolve with an error
        // result; core reports them to LearningConfig.onError or warns once.
        // Consume unexpected rejections without logging credentials, and stay
        // quiet for a start that a newer start or a stop already replaced.
        if (!start.stopped) console.warn(START_FAILED_WARNING);
      });
  }

  /**
   * Stops capture. A later `update()` starts again, reusing the generated
   * Trajectory ID.
   */
  dispose() {
    this.#stop();
    this.#prop = UNSET;
    this.#startKey = null;
  }

  #stop() {
    const start = this.#activeStart;
    if (!start) return;
    start.stopped = true;
    this.#activeStart = null;
    this.#core.stopTrajectory();
  }

  /** Each warning fires when its condition starts to hold, not on every update. */
  #warnOnce(config: ReturnType<typeof ɵtoLearningConfig>, autoStart: boolean) {
    // Automatic starts report unsupported options in core. With manual starts,
    // the provider's container option is not part of startTrajectory() options.
    const ignoresContainerIds =
      config?.sink === undefined &&
      !autoStart &&
      config?.learningContainerIds !== undefined;
    if (ignoresContainerIds && !this.#warnedContainerIds) {
      console.warn(CONTAINER_IDS_WARNING);
    }
    this.#warnedContainerIds = ignoresContainerIds;

    const ignoresTrajectoryId =
      !autoStart && config?.trajectoryId !== undefined;
    if (ignoresTrajectoryId && !this.#warnedIgnoredTrajectoryId) {
      console.warn(IGNORED_TRAJECTORY_ID_WARNING);
    }
    this.#warnedIgnoredTrajectoryId = ignoresTrajectoryId;
  }
}
