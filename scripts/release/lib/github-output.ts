import fs from "fs";

/**
 * Append step outputs to the file GitHub Actions exposes via GITHUB_OUTPUT.
 *
 * The publish-release workflow's "Verify publish step emitted version" guard
 * and the downstream summary/tag steps read `steps.publish.outputs.version`
 * (and `scope`), so every publish script must emit these after publishing.
 * No-op outside CI (GITHUB_OUTPUT unset), e.g. when running locally.
 *
 * Keys must match GitHub Actions' safe output-name shape
 * (`/^[A-Za-z_][A-Za-z0-9_-]*$/`); values must be single-line (no newline or
 * carriage return), since GITHUB_OUTPUT's `key=value` form splits on the first
 * `=` and cannot carry newlines (multi-line values would need the heredoc
 * form, which this helper deliberately does not support).
 */
export function emitGithubOutputs(outputs: Record<string, string>): void {
  for (const [key, value] of Object.entries(outputs)) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
      throw new Error(
        `emitGithubOutputs: key ${JSON.stringify(key)} is not a valid GitHub Actions output name; keys must be alphanumeric/underscore/dash and start with a letter or underscore.`,
      );
    }
    if (/[\n\r]/.test(value)) {
      throw new Error(
        `emitGithubOutputs: value for key ${JSON.stringify(key)} contains a newline or carriage return; GITHUB_OUTPUT's key=value form cannot carry newlines (multi-line values would need the heredoc form, which this helper deliberately does not support).`,
      );
    }
  }
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
  fs.appendFileSync(outputPath, lines);
}
