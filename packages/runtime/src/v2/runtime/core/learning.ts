import type { RunAgentInput } from "@ag-ui/client";
import type { MaybePromise } from "@copilotkit/shared";
import type { CopilotRuntimeLike } from "./runtime";

/** Checks configuration without invoking a selector that requires a real run. */
export function hasLearningContainerConfiguration(
  runtime: CopilotRuntimeLike,
): boolean {
  return (
    runtime.intelligence?.ɵgetLearningContainerId?.() !== undefined ||
    runtime.learning?.containerId !== undefined
  );
}

/** Application user resolved by an Intelligence runtime. */
export interface CopilotRuntimeUser {
  readonly id: string;
  readonly name: string;
}

/** Context for choosing a Learning Container through the public Intelligence SDK. */
export type LearningContainerSelectorInput =
  | {
      readonly surface: "web";
      readonly user: CopilotRuntimeUser;
      readonly agentId: string;
      readonly input: Readonly<RunAgentInput>;
    }
  | {
      readonly surface: "channel";
      readonly user: CopilotRuntimeUser | null;
      readonly agentId: string;
      readonly input: Readonly<RunAgentInput>;
    };

/** Chooses one developer-created Learning Container for an Intelligence run. */
export type GetLearningContainerId = (
  input: LearningContainerSelectorInput,
) => MaybePromise<string | null | undefined>;

/** Trusted server context for assigning browser activity to Learning Spaces. */
export interface TrajectoryLearningContainerSelectorInput {
  readonly trajectoryId: string;
  readonly user: CopilotRuntimeUser;
}

/**
 * Selects existing Learning Spaces without requiring an agent run or Thread.
 * The optional signal cancels on request abort or the five-second deadline.
 */
export type GetTrajectoryLearningContainerIds = (
  input: TrajectoryLearningContainerSelectorInput,
  signal?: AbortSignal,
) => MaybePromise<readonly string[] | null | undefined>;

/** Resolves bounded, validated Space IDs selected by application server code. */
export async function resolveTrajectoryLearningContainerIds(
  selector: GetTrajectoryLearningContainerIds | undefined,
  input: TrajectoryLearningContainerSelectorInput,
  signal?: AbortSignal,
): Promise<readonly string[] | undefined> {
  signal?.throwIfAborted();
  if (!selector) return undefined;
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(
    () =>
      controller.abort(
        new Error("Trajectory Learning Container selection timed out"),
      ),
    5_000,
  );
  let onCancelled: (() => void) | undefined;
  try {
    const cancelled = new Promise<never>((_resolve, reject) => {
      onCancelled = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onCancelled, { once: true });
    });
    const selection = new Promise<readonly string[] | null | undefined>(
      (resolve) => {
        resolve(selector(input, controller.signal));
      },
    );
    const value = await Promise.race([selection, cancelled]);
    controller.signal.throwIfAborted();
    if (value == null) return undefined;
    if (!Array.isArray(value) || value.length > 100) {
      throw new Error(
        "Trajectory Learning Container selection must be an array of at most 100 IDs",
      );
    }
    return [...new Set(value.map(assertStableLearningContainerId))];
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
    if (onCancelled)
      controller.signal.removeEventListener("abort", onCancelled);
  }
}

/** Context for choosing one Learning Container for an Intelligence run. */
export type CopilotRuntimeLearningContext =
  | {
      readonly surface: "web";
      readonly request: Request;
      readonly threadId: string;
      readonly runId: string;
      readonly agentId: string;
      readonly userId: string;
    }
  | {
      readonly surface: "channel";
      readonly threadId: string;
      readonly runId: string;
      readonly agentId: string;
      readonly userId: string;
      readonly deliveryId: string;
    };

/** Assigns each Intelligence Thread to one developer-created Learning Container. */
export interface CopilotRuntimeLearningConfig {
  readonly containerId:
    | string
    | ((
        input: CopilotRuntimeLearningContext,
      ) => MaybePromise<string | null | undefined>);
}

const STABLE_CONTAINER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Validates and returns a stable Learning Container ID. */
export function assertStableLearningContainerId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 64 ||
    !STABLE_CONTAINER_ID.test(value)
  ) {
    throw new Error(
      "Learning Container must use a 1-64 character stable ID with lowercase letters, numbers, and single hyphens",
    );
  }
  return value;
}

/** Resolves and validates a public Intelligence Learning Container selection. */
export async function resolveLearningContainerSelector(
  selector: GetLearningContainerId,
  input: LearningContainerSelectorInput,
): Promise<string | undefined> {
  const value = await selector(input);
  if (value == null) return undefined;
  return assertStableLearningContainerId(value);
}

/** Resolves the configured Container once for one web or Channel run. */
export async function resolveLearningContainerId(
  config: CopilotRuntimeLearningConfig | undefined,
  input: CopilotRuntimeLearningContext,
): Promise<string | undefined> {
  if (config === undefined) return undefined;
  const value =
    typeof config.containerId === "function"
      ? await config.containerId(input)
      : config.containerId;
  if (value == null) return undefined;
  return assertStableLearningContainerId(value);
}
