import { createFeatureSetupPrompt } from "./intelligence-onboarding-prompt";

/**
 * Canonical coding-agent prompt for configuring Automatic Learning.
 *
 * The `add-learning` route owns every instruction; see
 * `createFeatureSetupPrompt` for why none of them are repeated here.
 */
export const LEARNING_SETUP_PROMPT = createFeatureSetupPrompt("add-learning");
