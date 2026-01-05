import {
  TranscribeFileOptions,
  TranscriptionService,
} from "./transcription-service";
import OpenAI from "openai";

export interface TranscribeAdapterOpenAIConfig {
  openai: OpenAI;
  model?: string;
}

export class TranscriptionServiceOpenAI extends TranscriptionService {
  private openai: OpenAI;
  private model: string;

  constructor(config: TranscribeAdapterOpenAIConfig) {
    super();
    this.openai = config.openai ?? new OpenAI();
    this.model = config.model ?? "whisper-1";
  }

  async transcribeFile(options: TranscribeFileOptions): Promise<string> {
    const response = await this.openai.audio.transcriptions.create({
      file: options.audioFile,
      model: this.model,
    });
    return response.text;
  }
}
