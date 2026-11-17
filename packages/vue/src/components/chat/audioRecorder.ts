import type { ɵAudioRecorderState } from "@copilotkit/core";

export type AudioRecorderState = ɵAudioRecorderState;

export { ɵAudioRecorderError as AudioRecorderError } from "@copilotkit/core";

export interface CopilotChatAudioRecorderRef {
  state: AudioRecorderState;
  start: () => Promise<void>;
  stop: () => Promise<Blob>;
  dispose: () => void;
}
