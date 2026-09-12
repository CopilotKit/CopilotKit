import { createFeatureSetupPrompt } from "./intelligence-onboarding-prompt";

/**
 * Canonical coding-agent prompt for completing Rich Threads Runtime setup.
 *
 * The `add-rich-threads` route owns every instruction; see
 * `createFeatureSetupPrompt` for why none of them are repeated here.
 */
export const RICH_THREADS_SETUP_PROMPT =
  createFeatureSetupPrompt("add-rich-threads");
