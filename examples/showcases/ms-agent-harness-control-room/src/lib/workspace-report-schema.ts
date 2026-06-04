/**
 * JSON-Schema describing the structured workspace report the operator can ask the
 * agent for via the per-turn `forwardedProps.responseFormat` directive.
 *
 * Kept inline (not pulled from Zod) so the wire shape is unambiguous and the
 * UI can render fields without inferring TS types.
 */
export const WORKSPACE_REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "fix", "verification"],
  properties: {
    summary: {
      type: "string",
      description: "One-paragraph summary of the current workspace or request.",
    },
    fix: {
      type: "object",
      additionalProperties: false,
      required: ["file", "change"],
      properties: {
        file: {
          type: "string",
          description:
            "Workspace-relative file or data path relevant to the recommendation.",
        },
        change: {
          type: "string",
          description:
            "Minimal recommendation, next step, or change to consider.",
        },
      },
    },
    verification: {
      type: "object",
      additionalProperties: false,
      required: ["test_command", "expected_exit_code"],
      properties: {
        test_command: {
          type: "string",
          description:
            'pnpm command to run when execution is requested (e.g. "test", "typecheck", or "data:summary").',
        },
        expected_exit_code: {
          type: "integer",
          description: "Expected exit code when the command succeeds.",
        },
      },
    },
  },
} as const;

export interface WorkspaceReport {
  summary: string;
  fix: { file: string; change: string };
  verification: { test_command: string; expected_exit_code: number };
}

export function parseWorkspaceReport(raw: string): WorkspaceReport | null {
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceReport>;
    if (
      typeof parsed.summary === "string" &&
      parsed.fix &&
      typeof parsed.fix.file === "string" &&
      typeof parsed.fix.change === "string" &&
      parsed.verification &&
      typeof parsed.verification.test_command === "string" &&
      typeof parsed.verification.expected_exit_code === "number"
    ) {
      return parsed as WorkspaceReport;
    }
    return null;
  } catch {
    return null;
  }
}

/** Forms the OpenAI-shaped responseFormat payload to pass via forwardedProps. */
export function workspaceReportResponseFormat() {
  return {
    type: "json_schema" as const,
    json_schema: {
      name: "WorkspaceReport",
      description:
        "Structured workspace report emitted by the Control Room agent.",
      schema: WORKSPACE_REPORT_SCHEMA,
      strict: true,
    },
  };
}
