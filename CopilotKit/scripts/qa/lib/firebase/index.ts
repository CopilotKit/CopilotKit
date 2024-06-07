/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { onRequest } from "firebase-functions/v2/https";
// import * as logger from "firebase-functions/logger";
import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/runtime";

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

export const copilotKit = onRequest((request, response) => {
  const copilotKit = new CopilotRuntime();
  copilotKit.streamHttpServerResponse(request, response, new OpenAIAdapter({}));
});
