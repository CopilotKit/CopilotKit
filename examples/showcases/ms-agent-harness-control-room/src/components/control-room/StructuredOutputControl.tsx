"use client";

/**
 * Left-pane control that triggers a **per-turn structured-output** run.
 *
 * The button dispatches a normal user message asking the agent for a
 * workspace report, but it also threads the OpenAI-shaped `responseFormat`
 * directive through AG-UI's `forwardedProps`. Our app-side
 * `ForwardedPropsResponseFormatPromoter` (see `agent/`) promotes that into
 * the agent's per-call `ChatOptions.ResponseFormat`, so the LLM's final
 * assistant message is constrained to the workspace report schema.
 *
 * The framework (MAF / CopilotKit / AG-UI) is intentionally NOT in the
 * loop — the application owns both ends of the contract.
 */

import { useSendUserMessage } from "@/hooks/use-control-room-state";
import { workspaceReportResponseFormat } from "@/lib/workspace-report-schema";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const DIAGNOSIS_PROMPT =
  "Emit a structured workspace report: a concise summary, the most relevant " +
  "file or data path plus a recommended next step, and the command you would " +
  "use to verify it if execution were requested. Respond as JSON only — your " +
  "response will be parsed by the WorkspaceReport schema.";

export function StructuredOutputControl() {
  const { send, isRunning } = useSendUserMessage();

  const runStructured = () => {
    if (isRunning) return;
    void send(DIAGNOSIS_PROMPT, {
      forwardedProps: { responseFormat: workspaceReportResponseFormat() },
    });
  };

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Structured output</CardTitle>
        <CardDescription>
          Ask for a JSON workspace report using the pinned schema.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button
          type="button"
          onClick={runStructured}
          disabled={isRunning}
          className="w-full"
          variant="outline"
          size="sm"
        >
          Run structured report
        </Button>
        <p className="text-xs text-muted-foreground">
          Uses per-turn `forwardedProps.responseFormat`.
        </p>
      </CardContent>
    </Card>
  );
}
