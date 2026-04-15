import { build } from "rolldown";

export interface BundleResult {
  success: boolean;
  code?: string;
  error?: string;
}

export async function bundleCatalog(entryPath: string): Promise<BundleResult> {
  try {
    const result = await build({
      input: entryPath,
      write: false,
      output: {
        format: "esm",
      },
      external: ["react", "react-dom", /^@copilotkit\//],
      logLevel: "silent",
    });

    const output = result.output[0];
    if (!output) {
      return { success: false, error: "No output generated" };
    }

    return { success: true, code: output.code };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
