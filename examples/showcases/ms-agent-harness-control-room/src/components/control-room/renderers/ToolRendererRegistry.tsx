"use client";

/**
 * Wildcard tool-call renderer for the Control Room cockpit.
 *
 * In v2 the registration model changed: instead of `useRenderToolCall({ name,
 * render })` per tool name, we register ONE wildcard renderer with
 * `useRenderTool({ name: "*", render })` and dispatch on the tool name inside.
 * That keeps the cockpit agent-agnostic — works for both the Harness providers
 * and any future agent that exposes its own tool names.
 *
 * Known tool names get a dedicated card. The canonical approval path is
 * the synthetic `request_tool_approval` call emitted by our app-side
 * `ApprovalContentWireBridge` — it carries Harness's
 * `ToolApprovalRequestContent` across the AG-UI wire and renders through
 * `<HarnessApprovalCard>`. The legacy `repo_propose_patch` /
 * `command_request_approval` paths through `<DiffProposalCard>` are kept
 * for back-compat with older Harness wire shapes that may emit them, but
 * the live build doesn't exercise them.
 * Anything else falls through to a compact JSON dump so the user can still see
 * what fired without us having a custom renderer for it yet.
 */

import { useRenderTool } from "@copilotkit/react-core/v2";

import { CONTROL_ROOM_AGENT_NAME } from "@/hooks/use-control-room-state";
import { PrimitiveWrapperBadge } from "@/components/control-room/PrimitiveWrapperBadge";
import { CodeBlock } from "./CodeBlock";
import { DiffProposalCard } from "./DiffProposalCard";
import { FileReadCard } from "./FileReadCard";
import { GeneratedResultCard } from "./GeneratedResultCard";
import { HarnessApprovalCard } from "./HarnessApprovalCard";
import { ShellOutputCard } from "./ShellOutputCard";

interface RenderProps {
  name: string;
  toolCallId: string;
  args: Record<string, unknown> | undefined;
  status: "inProgress" | "executing" | "complete";
  result: string | undefined;
}

export function ToolRendererRegistry() {
  useRenderTool({
    name: "*",
    agentId: CONTROL_ROOM_AGENT_NAME,
    render: (rawProps) => {
      // The v2 renderer is typed against a known schema per registration —
      // wildcard renderers receive a less-strict union of in-progress /
      // executing / complete shapes. Coerce once for downstream cards.
      const props = rawProps as unknown as RenderProps;
      const { name, args, status } = props;
      const parsedResult = parseToolResult(props.result);

      switch (name) {
        case "request_approval":
          return (
            <HarnessApprovalCard
              toolCallId={props.toolCallId}
              args={args as never}
              status={status}
              result={parsedResult}
            />
          );

        case "shell_execute":
        case "command_run_registered":
        case "shell_run":
          return (
            <ShellOutputCard
              args={args as { command_name?: string }}
              status={status}
              result={parsedResult as never}
            />
          );

        case "file_read":
        case "repo_read_file":
          return (
            <FileReadCard
              args={args as { relative_path?: string }}
              status={status}
              result={parsedResult as never}
            />
          );

        case "file_write":
        case "repo_apply_patch":
        case "repo_propose_patch":
          return (
            <DiffProposalCard
              args={args}
              status={status}
              result={parsedResult as never}
            />
          );

        case "generated_result_card":
          return (
            <GeneratedResultCard
              args={args}
              status={status}
              result={parsedResult as never}
            />
          );

        default:
          return (
            <GenericToolCard
              name={name}
              args={args}
              status={status}
              result={parsedResult}
            />
          );
      }
    },
  });

  return null;
}

function parseToolResult(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function GenericToolCard({
  name,
  args,
  status,
  result,
}: {
  name: string;
  args: unknown;
  status: string;
  result: unknown;
}) {
  const statusTone =
    status === "complete"
      ? "emerald"
      : status === "executing"
        ? "amber"
        : status === "inProgress"
          ? "cyan"
          : undefined;
  return (
    <div className="cr-tool-card">
      <header className="cr-tool-card__header">
        <h3 className="cr-tool-card__title">Tool · {name}</h3>
        <span className="cr-chip" data-tone={statusTone}>
          {status}
        </span>
        <PrimitiveWrapperBadge />
      </header>
      {args !== undefined && (
        <section className="cr-tool-card__section">
          <div className="cr-tool-card__label">args</div>
          <CodeBlock
            code={JSON.stringify(args, null, 2)}
            language="json"
            maxHeight={220}
          />
        </section>
      )}
      {result !== undefined && (
        <section className="cr-tool-card__section">
          <div className="cr-tool-card__label">result</div>
          <CodeBlock
            code={
              typeof result === "string"
                ? result
                : JSON.stringify(result, null, 2)
            }
            language="json"
            maxHeight={260}
          />
        </section>
      )}
    </div>
  );
}
