import type { MaybePromise } from "@copilotkit/shared";

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
