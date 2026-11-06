import { z } from "zod";
import type { CatalogDefinitions } from "@copilotkit/a2ui-renderer";

/**
 * The A2UI catalog for test results. The agent authors a fixed surface (see
 * agent/src/repo_doctor/a2ui.py) whose props are all `{ path }` bindings into
 * the data model, so every prop here is a literal-or-binding union.
 *
 * These must be zod 3 schemas: the A2UI binder (@a2ui/web_core 0.10) inspects
 * zod 3 internals to decide which props are data bindings.
 */
const binding = z.object({ path: z.string() });
const dyn = <T extends z.ZodTypeAny>(schema: T) => z.union([schema, binding]);

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
      run: dyn(z.number()),
      status: dyn(z.enum(["passed", "failed", "error"])),
      headline: dyn(z.string()),
      command: dyn(z.string()),
      passed: dyn(z.number()),
      failed: dyn(z.number()),
      errors: dyn(z.number()),
      skipped: dyn(z.number()),
      durationSeconds: dyn(z.number()),
      files: dyn(z.array(FileResult)),
      failures: dyn(z.array(FailedTest)),
      /** The end of the runner's output, for runners without a parsed report. */
      summary: dyn(z.string()),
    }),
  },
} satisfies CatalogDefinitions;

export type Definitions = typeof definitions;
export type FileResultData = z.infer<typeof FileResult>;
export type FailedTestData = z.infer<typeof FailedTest>;
