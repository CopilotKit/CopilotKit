export interface UploadedFile {
  name: string;
  base64: string;
  mimeType: string;
  sizeBytes: number;
}

export interface Finding {
  id: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface RedactedItem {
  id: string;
  location: string;
  speculation: string;
  confidence: number;
}

export interface Tweet {
  id: string;
  content: string;
  posted: boolean;
}

export type AnalysisStatus = 'idle' | 'proposed' | 'analyzing' | 'complete';

export interface FileInvestigatorState {
  uploadedFiles: UploadedFile[];
  findings: Finding[];
  redactedContent: RedactedItem[];
  tweets: Tweet[];
  summary: string | null;
  analysisStatus: AnalysisStatus;
}

export const INITIAL_STATE: FileInvestigatorState = {
  uploadedFiles: [],
  findings: [],
  redactedContent: [],
  tweets: [],
  summary: null,
  analysisStatus: 'idle',
};
