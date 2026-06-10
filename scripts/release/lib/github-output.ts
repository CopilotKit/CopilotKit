import fs from "fs";

/**
 * Append step outputs to the file GitHub Actions exposes via GITHUB_OUTPUT.
 *
 * The publish-release workflow's "Verify publish step emitted version" guard
 * and the downstream summary/tag steps read `steps.publish.outputs.version`
 * (and `scope`), so every publish script must emit these after publishing.
 * No-op outside CI (GITHUB_OUTPUT unset), e.g. when running locally.
 */
export function emitGithubOutputs(outputs: Record<string, string>): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
  fs.appendFileSync(outputPath, lines);
}
