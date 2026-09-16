import { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { SkillDeliveryError } from "./errors.js";

export interface SkillRegistryOptions {
  client?: CopilotKitIntelligence;
  apiKey?: string;
  apiUrl?: string;
  containerId?: string;
  revision?: string;
  freshnessWindowMs?: number;
  requestTimeoutMs?: number;
  debug?: boolean;
}
export interface RegistryConfig {
  readonly client: CopilotKitIntelligence;
  readonly containerId: string;
  readonly revision?: string;
  readonly freshnessWindowMs: number;
  readonly requestTimeoutMs: number;
  readonly debug: boolean;
}

/** Resolve once. Never retain the options object, environment, or a second key. */
export function resolveRegistryConfig(
  options: SkillRegistryOptions = {},
  environment: NodeJS.ProcessEnv = process.env,
): RegistryConfig {
  try {
    const containerId =
      options.containerId ?? environment.CPK_INTELLIGENCE_LEARNING_CONTAINER_ID;
    const revision =
      options.revision ?? environment.CPK_INTELLIGENCE_SKILLS_REVISION;
    const freshnessWindowMs = options.freshnessWindowMs ?? 5_000;
    const requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
    const debug = options.debug ?? false;
    if (
      typeof containerId !== "string" ||
      !containerId.trim() ||
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
      if (!client || typeof client.getLearnedSkillsSnapshot !== "function")
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
      containerId,
      ...(revision !== undefined ? { revision } : {}),
      freshnessWindowMs,
      requestTimeoutMs,
      debug,
    });
  } catch (error) {
    if (error instanceof SkillDeliveryError) throw error;
    throw new SkillDeliveryError("INVALID_CONFIG", false, error);
  }
}
