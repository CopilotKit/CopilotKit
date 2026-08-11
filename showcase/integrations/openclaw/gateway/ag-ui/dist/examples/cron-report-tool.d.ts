/**
 * Server-side `cron_report` tool that wraps cron job data in A2UI v0.9 schema.
 *
 * The agent calls this tool with an array of cron run objects. The execute
 * method wraps them in a fixed A2UI v0.9 component tree (cards with
 * startedAt, duration, model, tokensUsed, summary) and returns the result
 * as JSON text.  The `handleToolResultPersist` hook in index.ts detects the
 * A2UI wrapper and emits `ACTIVITY_SNAPSHOT` events automatically.
 */
/**
 * Tool factory for the `cron_report` server-side tool.
 *
 * Returns the tool when a sessionKey is present (i.e. within an AG-UI
 * request), or `null` otherwise.
 */
export declare function cronReportToolFactory(ctx: { sessionKey?: string }): {
  name: string;
  label: string;
  description: string;
  parameters: {
    type: "object";
    properties: {
      runs: {
        type: "array";
        items: {
          type: "object";
          properties: {
            id: {
              type: "string";
              description: string;
            };
            startedAt: {
              type: "string";
              description: string;
            };
            duration: {
              type: "string";
              description: string;
            };
            model: {
              type: "string";
              description: string;
            };
            tokensUsed: {
              type: "string";
              description: string;
            };
            summary: {
              type: "string";
              description: string;
            };
          };
          required: string[];
        };
      };
    };
    required: string[];
  };
  execute(
    _toolCallId: string,
    args: unknown,
  ): Promise<{
    content: {
      type: "text";
      text: string;
    }[];
    details: {
      a2ui: boolean;
    };
  }>;
} | null;
