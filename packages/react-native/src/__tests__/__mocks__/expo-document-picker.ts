// Stub for expo-document-picker — replaced at runtime by vi.mock() in tests.
// This file exists so Vite's import analysis can resolve the module.
export async function getDocumentAsync(_options?: unknown): Promise<{
  canceled: boolean;
  assets: Array<{
    uri: string;
    name: string;
    size: number;
    mimeType: string;
  }>;
}> {
  return { canceled: true, assets: [] };
}
