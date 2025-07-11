/**
 * Constants for suggestions retry logic
 */

export const SUGGESTION_RETRY_CONFIG = {
  MAX_RETRIES: 3,
  COOLDOWN_MS: 5000, // 5 seconds
} as const;
