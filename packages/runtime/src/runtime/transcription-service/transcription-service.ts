export interface TranscribeFileOptions {
  audioFile: File;
  /** MIME type of the audio file */
  mimeType?: string;
  /** Size of the audio file in bytes */
  size?: number;
}

export abstract class TranscriptionService {
  abstract transcribeFile(options: TranscribeFileOptions): Promise<string>;
}
