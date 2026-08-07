/**
 * JSON-Schema describing the structured diagnosis the operator can ask the
 * agent for via the per-turn `forwardedProps.responseFormat` directive.
 *
 * Kept inline (not pulled from Zod) so the wire shape is unambiguous and the
 * UI can render fields without inferring TS types.
 */
export const FIXTURE_DIAGNOSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "fix", "verification"],
  properties: {
    summary: {
      type: "string",
      description: "One-paragraph summary of the bug observed in the fixture.",
    },
    fix: {
      type: "object",
      additionalProperties: false,
      required: ["file", "change"],
      properties: {
        file: {
          type: "string",
          description:
            "Path of the file that needs to change, relative to fixture root.",
        },
        change: {
          type: "string",
          description: "Minimal description of the change required.",
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
          description: 'pnpm script to run (e.g. "test" or "test:coverage").',
        },
        expected_exit_code: {
          type: "integer",
          description:
            "Exit code the test command should return after the fix.",
        },
      },
    },
  },
} as const;

export interface FixtureDiagnosis {
  summary: string;
  fix: { file: string; change: string };
  verification: { test_command: string; expected_exit_code: number };
}

export function parseFixtureDiagnosis(raw: string): FixtureDiagnosis | null {
  try {
    const parsed = JSON.parse(raw) as Partial<FixtureDiagnosis>;
    if (
      typeof parsed.summary === "string" &&
      parsed.fix &&
      typeof parsed.fix.file === "string" &&
      typeof parsed.fix.change === "string" &&
      parsed.verification &&
      typeof parsed.verification.test_command === "string" &&
      typeof parsed.verification.expected_exit_code === "number"
    ) {
      return parsed as FixtureDiagnosis;
    }
    return null;
  } catch {
    return null;
  }
}

/** Forms the OpenAI-shaped responseFormat payload to pass via forwardedProps. */
export function fixtureDiagnosisResponseFormat() {
  return {
    type: "json_schema" as const,
    json_schema: {
      name: "FixtureDiagnosis",
      description:
        "Structured diagnosis emitted by the Control Room agent for a fixture test failure.",
      schema: FIXTURE_DIAGNOSIS_SCHEMA,
      strict: true,
    },
  };
}
