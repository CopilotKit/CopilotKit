import { CopilotKitIntelligence } from "../client";
import { SkillDeliveryError } from "./errors";

export interface SkillRegistryCommonOptions {
  client?: CopilotKitIntelligence;
  apiKey?: string;
  apiUrl?: string;
  freshnessWindowMs?: number;
  requestTimeoutMs?: number;
  debug?: boolean;
}
/** One published container and an optional exact revision pin. */
export interface SkillRegistryContainer {
  readonly id: string;
  readonly revision?: string;
}

/** Legacy selection and explicit multi-container selection cannot be combined. */
export type SkillRegistryOptions = SkillRegistryCommonOptions &
  (
    | { containerId?: string; revision?: string; containers?: never }
    | {
        containers: readonly SkillRegistryContainer[];
        containerId?: never;
        revision?: never;
      }
  );

interface RegistryCommonConfig {
  readonly client: CopilotKitIntelligence;
  readonly freshnessWindowMs: number;
  readonly requestTimeoutMs: number;
  readonly debug: boolean;
}

export type SingleContainerConfig = RegistryCommonConfig & {
  readonly containerId: string;
  readonly revision?: string;
  readonly containers?: never;
};

export type RegistryConfig =
  | SingleContainerConfig
  | (RegistryCommonConfig & {
      readonly containers: readonly SkillRegistryContainer[];
      readonly containerId?: never;
      readonly revision?: never;
    });

/** Resolve once. Never retain the options object, environment, or a second key. */
export function resolveRegistryConfig(
  options: SkillRegistryOptions = {},
  environment: NodeJS.ProcessEnv = process.env,
): RegistryConfig {
  try {
    const multiple = options.containers !== undefined;
    if (
      multiple &&
      (options.containerId !== undefined || options.revision !== undefined)
    ) {
      throw new SkillDeliveryError("INVALID_CONFIG", false);
    }
    const containerId = multiple
      ? undefined
      : (options.containerId ??
        environment.CPK_INTELLIGENCE_LEARNING_CONTAINER_ID);
    const revision = multiple
      ? undefined
      : (options.revision ?? environment.CPK_INTELLIGENCE_SKILLS_REVISION);
    let containers: readonly SkillRegistryContainer[] | undefined;
    if (multiple) {
      if (
        !Array.isArray(options.containers) ||
        options.containers.length === 0 ||
        options.containers.length > 50
      ) {
        throw new SkillDeliveryError("INVALID_CONFIG", false);
      }
      const seen = new Set<string>();
      containers = Object.freeze(
        options.containers.map((source) => {
          if (
            !source ||
            typeof source.id !== "string" ||
            !source.id.trim() ||
            /[\u0000-\u001f\u007f]/.test(source.id) ||
            seen.has(source.id) ||
            (source.revision !== undefined &&
              (typeof source.revision !== "string" || !source.revision.trim()))
          ) {
            throw new SkillDeliveryError("INVALID_CONFIG", false);
          }
          // Reject malformed Unicode before constructing a qualified tool name.
          encodeURIComponent(source.id);
          seen.add(source.id);
          return Object.freeze({
            id: source.id,
            ...(source.revision !== undefined
              ? { revision: source.revision }
              : {}),
          });
        }),
      );
    }
    const freshnessWindowMs = options.freshnessWindowMs ?? 5_000;
    const requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
    const debug = options.debug ?? false;
    if (
      (!multiple && (typeof containerId !== "string" || !containerId.trim())) ||
      (revision !== undefined &&
        (typeof revision !== "string" || revision.length === 0)) ||
      !Number.isSafeInteger(freshnessWindowMs) ||
      freshnessWindowMs < 0 ||
      !Number.isSafeInteger(requestTimeoutMs) ||
      requestTimeoutMs < 1 ||
      requestTimeoutMs > 2_147_483_647 ||
      typeof debug !== "boolean"
    )
      throw new SkillDeliveryError("INVALID_CONFIG", false);
    let client = options.client;
    if (client !== undefined) {
      if (
        !client ||
        typeof (multiple
          ? client.getLearnedSkillsSnapshots
          : client.getLearnedSkillsSnapshot) !== "function"
      )
        throw new SkillDeliveryError("INVALID_CONFIG", false);
    } else {
      const apiKey = options.apiKey ?? environment.CPK_INTELLIGENCE_API_KEY;
      const apiUrl = options.apiUrl ?? environment.INTELLIGENCE_API_URL;
      if (typeof apiKey !== "string" || !apiKey.trim())
        throw new SkillDeliveryError("INVALID_CONFIG", false);
      if (apiUrl?.trim()) {
        const url = new URL(apiUrl);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new SkillDeliveryError("INVALID_CONFIG", false);
      }
      client = new CopilotKitIntelligence({
        apiKey,
        ...(apiUrl !== undefined ? { apiUrl } : {}),
        // This private helper client uses REST only. Explicitly retain the
        // canonical websocket default to prevent an irrelevant host warning.
        ...(apiUrl?.trim()
          ? { wsUrl: "wss://realtime.intelligence.copilotkit.ai" }
          : {}),
      });
    }
    return Object.freeze({
      client,
      ...(containers
        ? { containers }
        : {
            containerId: containerId!,
            ...(revision !== undefined ? { revision } : {}),
          }),
      freshnessWindowMs,
      requestTimeoutMs,
      debug,
    });
  } catch (error) {
    if (error instanceof SkillDeliveryError) throw error;
    throw new SkillDeliveryError("INVALID_CONFIG", false, error);
  }
}
