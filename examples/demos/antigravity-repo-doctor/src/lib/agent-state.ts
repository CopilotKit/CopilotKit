import { z } from "zod";

/**
 * The shared state the agent's tools write (agent/src/repo_doctor/tools.py and
 * approvals.py). It arrives over the network, so it is parsed, not trusted.
 */

const Repo = z.object({
  slug: z.string(),
  /** Absolute workspace path, used to show repo-relative paths. */
  path: z.string(),
  url: z.string(),
  branch: z.string(),
  commit: z.string(),
  commitSubject: z.string(),
  language: z.enum(["python", "node", "go", "rust"]).optional(),
  installCommand: z.string().optional(),
  testCommand: z.string().optional(),
});

const TestRun = z.object({
  run: z.number(),
  status: z.enum(["passed", "failed", "error"]),
  headline: z.string(),
  passed: z.number(),
  failed: z.number(),
  total: z.number(),
  durationSeconds: z.number(),
  target: z.string().nullable(),
});

/** One run_check: a single command that reproduces a CI step. */
const Check = z.object({
  run: z.number(),
  label: z.string(),
  command: z.string(),
  status: z.enum(["passed", "failed"]),
  /** Null when the command timed out. */
  exitCode: z.number().nullable().catch(null),
  timedOut: z.boolean().catch(false),
  headline: z.string(),
  durationSeconds: z.number().catch(0),
});

const Approval = z.object({
  id: z.string(),
  tool: z.string(),
  summary: z.string(),
  decision: z.enum(["approved", "denied"]),
  at: z.string(),
  note: z.string().optional(),
});

const Install = z.object({
  command: z.string(),
  packages: z.array(z.object({ name: z.string(), version: z.string() })),
});

const Push = z.object({
  branch: z.string(),
  commit: z.string(),
  files: z.array(z.string()),
});

// Each field falls back on its own, so one malformed field cannot blank the
// whole panel.
const AgentState = z.object({
  repo: Repo.optional().catch(undefined),
  install: Install.optional().catch(undefined),
  testRuns: z.array(TestRun).catch([]),
  // Threads saved before checks existed have no field: an empty list.
  checks: z.array(Check).catch([]),
  approvals: z.array(Approval).catch([]),
  push: Push.optional().catch(undefined),
});

export type AgentState = z.infer<typeof AgentState>;
export type TestRun = z.infer<typeof TestRun>;
export type Check = z.infer<typeof Check>;
export type Approval = z.infer<typeof Approval>;

export function parseAgentState(raw: unknown): AgentState {
  return AgentState.parse(raw && typeof raw === "object" ? raw : {});
}
