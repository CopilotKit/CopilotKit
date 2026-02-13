import {
  TranscribeFileOptions,
  TranscriptionService,
} from "@copilotkitnext/runtime";
import OpenAI from "openai";

/**
 * Configuration options for the OpenAI transcription service.
 */
export interface TranscriptionServiceOpenAIConfig {
  /** OpenAI client instance. */
  openai: OpenAI;
  /** Whisper model to use. Defaults to "whisper-1". */
  model?: string;
  /**
   * Language of the audio in ISO-639-1 format (e.g., "en", "de", "fr").
   * Providing the language improves accuracy and latency.
   */
  language?: string;
  /**
   * Optional text to guide the model's style or continue a previous segment.
   * Should match the audio language.
   */
  prompt?: string;
  /**
   * Sampling temperature between 0 and 1.
   * Lower values are more deterministic, higher values more creative.
   */
  temperature?: number;
}

export class TranscriptionServiceOpenAI extends TranscriptionService {
  private openai: OpenAI;
  private model: string;
  private language?: string;
  private prompt?: string;
  private temperature?: number;

  constructor(config: TranscriptionServiceOpenAIConfig) {
    super();
    this.openai = config.openai ?? new OpenAI();
    this.model = config.model ?? "whisper-1";
    this.language = config.language;
    this.prompt = config.prompt;
    this.temperature = config.temperature;
  }

  async transcribeFile(options: TranscribeFileOptions): Promise<string> {
    const response = await this.openai.audio.transcriptions.create({
      file: options.audioFile,
      model: this.model,
      ...(this.language && { language: this.language }),
      ...(this.prompt && { prompt: this.prompt }),
      ...(this.temperature !== undefined && { temperature: this.temperature }),
    });
    return response.text;
  }
}
