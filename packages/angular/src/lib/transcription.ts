/**
 * Audio transcription through the CopilotKit runtime. The request and the
 * error handling come from `@copilotkit/core`, so React, Vue and Angular
 * behave the same.
 *
 * `transcribeAudio(core, blob)` sends a recording and returns its text. It
 * throws a `TranscriptionError`. Read `error.info.code` to pick a message for
 * the user.
 */
export {
  ɵtranscribeAudio as transcribeAudio,
  TranscriptionError,
  TranscriptionErrorCode,
} from "@copilotkit/core";
export type {
  TranscriptionResult,
  TranscriptionErrorInfo,
} from "@copilotkit/core";
