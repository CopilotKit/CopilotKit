import { PlatformRequestError } from "../../intelligence-platform/client";

/**
 * Returns the HTTP status carried by platform request errors.
 */
export function getPlatformErrorStatus(error: unknown): number | undefined {
  if (error instanceof PlatformRequestError) {
    return error.status;
  }

  if (
    error !== null &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }

  return undefined;
}

export function isPlatformNotFoundError(error: unknown): boolean {
  return getPlatformErrorStatus(error) === 404;
}

const MAX_ID_LENGTH = 128;
const SAFE_ID_PATTERN = /^[\w.@:=-]+$/;

/**
 * Validates that a string identifier (userId, agentId) is safe to pass through.
 * Returns `true` if valid, `false` otherwise.
 */
export function isValidIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    SAFE_ID_PATTERN.test(value)
  );
}
