// Stub for expo-file-system — replaced at runtime by vi.mock() in tests.
// This file exists so Vite's import analysis can resolve the module.
export const EncodingType = {
  Base64: "base64",
} as const;

export async function readAsStringAsync(
  _uri: string,
  _options?: unknown,
): Promise<string> {
  return "";
}
