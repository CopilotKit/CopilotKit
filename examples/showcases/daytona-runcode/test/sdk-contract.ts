// Type-only contract between the Daytona cookbook recipe and the pinned
// `@daytonaio/sdk`. This file is never executed: `npm test` type-checks it
// (with the whole app) against the installed SDK types, so an SDK pin that
// drops or changes an API the recipe or its "Going further" section uses
// fails the check.
import { Daytona } from "@daytonaio/sdk";
import type { Process, Sandbox } from "@daytonaio/sdk";

type RecipeLanguage = "python" | "typescript" | "javascript";
type CodeRunResult = Awaited<ReturnType<Process["codeRun"]>>;

// The recipe calls `new Daytona()` with no arguments (reads DAYTONA_API_KEY).
export const createClient: () => Daytona = () => new Daytona();

export async function recipeContract(
  daytona: Daytona,
  code: string,
  language: RecipeLanguage,
): Promise<{ stdout: string; exitCode: number }> {
  const sandbox: Sandbox = await daytona.create({ language });
  try {
    const res: CodeRunResult = await sandbox.process.codeRun(code);
    // The recipe documents that stdout lives on `result`, not `stdout`.
    return { stdout: res.result, exitCode: res.exitCode };
  } finally {
    await sandbox.delete();
  }
}

// APIs named in the recipe's "Going further" section.
export async function goingFurtherContract(sandbox: Sandbox): Promise<void> {
  await sandbox.stop();
  await sandbox.getPreviewLink(3000);
  const res: CodeRunResult = await sandbox.process.executeCommand("echo hi");
  void res.exitCode;
}
