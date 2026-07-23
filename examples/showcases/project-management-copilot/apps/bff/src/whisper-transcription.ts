import "reflect-metadata";
import { OpenAI } from "openai";
import type { TranscribeFileOptions } from "@copilotkit/runtime/v2";
import { TranscriptionService } from "@copilotkit/runtime/v2";

/**
 * WhisperTranscriptionService — converts uploaded audio blobs to text via the
 * OpenAI Whisper API. CopilotKit v2's `<CopilotChat>` auto-detects the mic
 * button when the runtime has a transcriptionService registered.
 *
 * The PTT (push-to-talk) flow: user holds the mic, browser records to an
 * audio Blob, CopilotChat POSTs the audio File here, we forward to
 * openai.audio.transcriptions.create with model="whisper-1", and respond
 * with the transcript string. The chat input then receives the transcript
 * as if the user typed it.
 */
export class WhisperTranscriptionService extends TranscriptionService {
  private client: OpenAI;
  private model: string;

  constructor({
    apiKey = process.env.OPENAI_API_KEY,
    baseURL = process.env.OPENAI_BASE_URL,
    model = "whisper-1",
  }: {
    apiKey?: string;
    baseURL?: string;
    model?: string;
  } = {}) {
    super();
    if (!apiKey) {
      console.warn(
        "[whisper] OPENAI_API_KEY not set — PTT voice will fail at runtime.",
      );
    }
    this.client = new OpenAI({
      apiKey: apiKey ?? "missing",
      ...(baseURL ? { baseURL } : {}),
    });
    this.model = model;
  }

  async transcribeFile({ audioFile }: TranscribeFileOptions): Promise<string> {
    const result = await this.client.audio.transcriptions.create({
      file: audioFile,
      model: this.model,
      response_format: "text",
    });
    // The SDK returns a string when response_format=text.
    return typeof result === "string"
      ? result
      : (result as { text: string }).text;
  }
}
