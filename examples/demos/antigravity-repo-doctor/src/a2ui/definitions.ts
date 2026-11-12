import { z } from "zod";

/**
 * The generative UI catalog for test results. The agent authors a fixed A2UI
 * v0.9 surface (see agent/src/repo_doctor/a2ui.py) whose props are all
 * `{ path }` bindings into the data model. The runtime converts the surface
 * to A2UI 1.0, and generative UI resolves each binding before it renders, so
 * the props here are the plain resolved types.
 */
const FileResult = z.object({
  path: z.string(),
  passed: z.number(),
  failed: z.number(),
});
const FailedTest = z.object({ id: z.string(), message: z.string() });

export const definitions = {
  TestReport: {
    description:
      "The result of one test run: status, counts, per-file results and failures.",
    props: z.object({
      run: z.number(),
      status: z.enum(["passed", "failed", "error"]),
      headline: z.string(),
      command: z.string(),
      passed: z.number(),
      failed: z.number(),
      errors: z.number(),
      skipped: z.number(),
      durationSeconds: z.number(),
      files: z.array(FileResult),
      failures: z.array(FailedTest),
      /** The end of the runner's output, for runners without a parsed report. */
      summary: z.string(),
    }),
  },
};

export type Definitions = typeof definitions;
export type FileResultData = z.infer<typeof FileResult>;
export type FailedTestData = z.infer<typeof FailedTest>;
