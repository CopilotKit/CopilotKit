import type { RunAgentInput } from "@ag-ui/client";
import type { MaybePromise } from "@copilotkit/shared";

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
