"use client";

/**
 * Right-pane inspector for the most recent **structured-output** response.
 *
 * The Control Room frontend can ask the agent to return JSON matching a
 * specific schema by passing the directive through AG-UI's `forwardedProps`:
 *
 *     copilotkit.runAgent({
 *       agent,
 *       forwardedProps: { responseFormat: { type: "json_schema", json_schema: { ... } } },
 *     })
 *
 * Our app's `ForwardedPropsResponseFormatPromoter` (a DelegatingChatClient
 * wrapper, in `agent/`) reads that directive and promotes it into the
 * agent's per-call `ChatOptions.ResponseFormat`. MAF then constrains the
 * underlying LLM call to the schema, and the final assistant message
 * arrives as valid JSON.
 *
 * `useControlRoomAgentState` parses it and exposes it as
 * `structuredDiagnosis`; this card renders the typed fields.
 *
 * Native primitive — no wrapper badge.
 */

import { useControlRoomAgentState } from "@/hooks/use-control-room-state";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function StructuredDiagnosisPanel() {
  const { structuredDiagnosis } = useControlRoomAgentState();

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Structured diagnosis</CardTitle>
        <CardDescription>
          Latest schema-constrained diagnosis from the agent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!structuredDiagnosis ? (
          <p className="text-xs text-muted-foreground">
            No structured response yet. Trigger one from this drawer.
          </p>
        ) : (
          <dl className="space-y-3 text-sm">
            <div className="space-y-1">
              <dt className="text-xs font-medium text-muted-foreground">
                Summary
              </dt>
              <dd className="leading-snug text-foreground">
                {structuredDiagnosis.payload.summary}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs font-medium text-muted-foreground">
                Fix file
              </dt>
              <dd>
                <Badge variant="outline">
                  {structuredDiagnosis.payload.fix.file}
                </Badge>
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs font-medium text-muted-foreground">
                Change
              </dt>
              <dd className="leading-snug text-foreground">
                {structuredDiagnosis.payload.fix.change}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs font-medium text-muted-foreground">
                Verify
              </dt>
              <dd className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  pnpm_run ·{" "}
                  {structuredDiagnosis.payload.verification.test_command}
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    structuredDiagnosis.payload.verification
                      .expected_exit_code === 0
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                  }
                >
                  exit{" "}
                  {structuredDiagnosis.payload.verification.expected_exit_code}
                </Badge>
              </dd>
            </div>
          </dl>
        )}
        <p className="text-xs text-muted-foreground">
          Per-turn directive via `forwardedProps.responseFormat`.
        </p>
      </CardContent>
    </Card>
  );
}
