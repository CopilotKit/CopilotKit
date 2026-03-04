export type {
  ComparisonRule,
  LogicalRule,
  ExistenceRule,
  Rule,
  BaseCondition,
  ComparisonCondition,
  LogicalCondition,
  ExistenceCondition,
  Condition,
} from "./conditions";
export { executeConditions } from "./conditions";
export {
  ConsoleColors,
  ConsoleStyles,
  logCopilotKitPlatformMessage,
  publicApiKeyRequired,
  logStyled,
  styledConsole,
} from "./console-styling";
export {
  Severity,
  ErrorVisibility,
  ERROR_NAMES,
  BANNER_ERROR_NAMES,
  COPILOT_CLOUD_ERROR_NAMES,
  CopilotKitErrorCode,
  ERROR_CONFIG,
  CopilotKitError,
  CopilotKitMisuseError,
  CopilotKitVersionMismatchError,
  CopilotKitApiDiscoveryError,
  CopilotKitRemoteEndpointDiscoveryError,
  CopilotKitAgentDiscoveryError,
  CopilotKitLowLevelError,
  ResolvedCopilotKitError,
  ConfigurationError,
  MissingPublicApiKeyError,
  UpgradeRequiredError,
  isStructuredCopilotKitError,
  ensureStructuredError,
  getPossibleVersionMismatch,
} from "./errors";
export type {
  JSONSchemaString,
  JSONSchemaNumber,
  JSONSchemaBoolean,
  JSONSchemaObject,
  JSONSchemaArray,
  JSONSchema,
} from "./json-schema";
export {
  actionParametersToJsonSchema,
  jsonSchemaToActionParameters,
  convertJsonSchemaToZodSchema,
  getZodParameters,
} from "./json-schema";
export type {
  MaybePromise,
  NonEmptyRecord,
  AgentDescription,
  RuntimeInfo,
} from "./types";
export { randomId, randomUUID, dataToUUID, isValidUUID } from "./random-id";
export { readBody } from "./requests";

/**
 * Safely parses a JSON string into an object
 * @param json The JSON string to parse
 * @param fallback Optional fallback value to return if parsing fails. If not provided or set to "unset", returns null
 * @returns The parsed JSON object, or the fallback value (or null) if parsing fails
 */
export function parseJson(json: string, fallback: any = "unset") {
  try {
    return JSON.parse(json);
  } catch (e) {
    return fallback === "unset" ? null : fallback;
  }
}

/**
 * Maps an array of items to a new array, skipping items that throw errors during mapping
 * @param items The array to map
 * @param callback The mapping function to apply to each item
 * @returns A new array containing only the successfully mapped items
 */
export function tryMap<TItem, TMapped>(
  items: TItem[],
  callback: (item: TItem, index: number, array: TItem[]) => TMapped,
): TMapped[] {
  return items.reduce<TMapped[]>((acc, item, index, array) => {
    try {
      acc.push(callback(item, index, array));
    } catch (error) {
      console.error(error);
    }
    return acc;
  }, []);
}

/**
 * Checks if the current environment is macOS
 * @returns {boolean} True if running on macOS, false otherwise
 */
export function isMacOS(): boolean {
  return /Mac|iMac|Macintosh/i.test(navigator.userAgent);
}
