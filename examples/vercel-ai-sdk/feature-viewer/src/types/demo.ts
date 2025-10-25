export interface DemoConfig {
  id: string;
  name: string;
  description: string;
  path: string;
  defaultLLMProvider: string;
  tags: string[];
  files: FileInfo[];
}

export interface FileInfo {
  name: string;
  content: string;
  path: string;
  language: string;
  type: "file";
}
