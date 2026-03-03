const COPILOT_CLOUD_PUBLIC_API_KEY_REGEX = /^ck_pub_[0-9a-f]{32}$/i;

/**
 * Returns true if the given string is a valid CopilotCloud public API key.
 */
export function isValidCopilotCloudKey(key: string): boolean {
  return COPILOT_CLOUD_PUBLIC_API_KEY_REGEX.test(key);
}
