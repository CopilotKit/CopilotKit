export type AudioRecorderState = "idle" | "recording" | "processing";

export class AudioRecorderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioRecorderError";
  }
}

export interface CopilotChatAudioRecorderRef {
  state: AudioRecorderState;
  start: () => Promise<void>;
  stop: () => Promise<Blob>;
  dispose: () => void;
}
