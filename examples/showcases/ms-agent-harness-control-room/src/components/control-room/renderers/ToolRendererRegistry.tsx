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
 * the synthetic `request_approval` call emitted by our app-side
 * `ApprovalContentWireBridge` — it carries Harness's
 * `ToolApprovalRequestContent` across the AG-UI wire and renders through
 * `<HarnessApprovalCard>`. The legacy `repo_propose_patch` /
 * `command_request_approval` paths through `<DiffProposalCard>` are kept
 * for back-compat with older Harness wire shapes that may emit them, but
 * the live build doesn't exercise them.
 * Anything else falls through to a compact JSON dump so the user can still see
 * what fired without us having a custom renderer for it yet.
 */

import { useEffect, useMemo, useRef } from "react";
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
  useA2UIError,
  DEFAULT_SURFACE_ID,
} from "@copilotkit/a2ui-renderer";
import { useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";

import { controlRoomA2UICatalog } from "@/components/control-room/a2ui-catalog";
import { CONTROL_ROOM_AGENT_NAME } from "@/hooks/use-control-room-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const CONTROL_ROOM_A2UI_TOOL_NAME = "render_control_room_a2ui";
const CONTROL_ROOM_A2UI_CATALOG_ID =
  "copilotkit://ms-agent-harness-control-room";

export function ToolRendererRegistry() {
  useRenderTool({
    name: CONTROL_ROOM_A2UI_TOOL_NAME,
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: z.any(),
    render: (rawProps) => {
      const props = rawProps as unknown as RenderProps;
      return <StreamingA2UIToolCard {...props} />;
    },
  });

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
        case "pnpm_run":
          return (
            <ShellOutputCard
              args={args as { command?: string; command_name?: string }}
              status={status}
              result={parsedResult as never}
            />
          );

        case "file_read":
        case "repo_read_file":
        case "FileAccess_ReadFile":
          return (
            <FileReadCard
              args={
                args as {
                  relative_path?: string;
                  fileName?: string;
                  path?: string;
                }
              }
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

function StreamingA2UIToolCard({ toolCallId, args, status }: RenderProps) {
  if (status === "complete") {
    return <></>;
  }

  const components = getRenderableA2UIComponents(args);
  if (components.length === 0) {
    return (
      <A2UIStreamingSkeleton
        status={status}
        components={getComponentCount(args)}
      />
    );
  }

  const surfaceId = `control-room-a2ui-stream-${toolCallId}`;
  const operations = buildA2UIOperations(surfaceId, components);

  return (
    <A2UIStreamingFrame
      status={status}
      componentCount={components.length}
      isPreview
    >
      <A2UIToolSurface operations={operations} />
    </A2UIStreamingFrame>
  );
}

function A2UIToolSurface({ operations }: { operations: unknown[] }) {
  const surfaceId = useMemo(() => {
    return (
      operations
        .map((operation) => getOperationSurfaceId(operation))
        .find(Boolean) ?? DEFAULT_SURFACE_ID
    );
  }, [operations]);

  return (
    <A2UIProvider theme={{}} catalog={controlRoomA2UICatalog}>
      <A2UIOperationProcessor surfaceId={surfaceId} operations={operations} />
      <A2UIRenderOrError surfaceId={surfaceId} />
    </A2UIProvider>
  );
}

function A2UIOperationProcessor({
  surfaceId,
  operations,
}: {
  surfaceId: string;
  operations: unknown[];
}) {
  const { processMessages, getSurface } = useA2UIActions();
  const lastHashRef = useRef("");

  useEffect(() => {
    const hash = JSON.stringify(operations);
    if (hash === lastHashRef.current) return;
    lastHashRef.current = hash;

    const existing = getSurface(surfaceId);
    const nextOperations = existing
      ? operations.filter((operation) => !(operation as any)?.createSurface)
      : operations;

    processMessages(nextOperations as Array<Record<string, unknown>>);
  }, [getSurface, operations, processMessages, surfaceId]);

  return null;
}

function A2UIRenderOrError({ surfaceId }: { surfaceId: string }) {
  const error = useA2UIError();
  if (error) {
    return (
      <A2UIStreamingSkeleton
        status="executing"
        components={0}
        detail={`A2UI preview is waiting for valid component data: ${error}`}
      />
    );
  }

  return <A2UIRenderer surfaceId={surfaceId} className="flex flex-1" />;
}

function A2UIStreamingFrame({
  status,
  componentCount,
  isPreview,
  children,
}: {
  status: RenderProps["status"];
  componentCount: number;
  isPreview?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="my-3 max-w-5xl rounded-xl border border-blue-200/80 bg-white p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <span className="size-2 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 shadow-[0_0_0_3px_rgba(37,99,235,0.12)]" />
          {isPreview ? "Streaming A2UI preview" : "A2UI surface"}
        </div>
        <Badge
          variant="outline"
          className="border-blue-200 bg-blue-50 text-[11px] text-blue-700"
        >
          {status === "inProgress" ? "streaming" : status}
          {componentCount > 0 ? ` · ${componentCount} components` : null}
        </Badge>
      </div>
      {children}
    </div>
  );
}

function A2UIStreamingSkeleton({
  status,
  components,
  detail,
}: {
  status: RenderProps["status"];
  components: number;
  detail?: string;
}) {
  return (
    <A2UIStreamingFrame status={status} componentCount={components} isPreview>
      <div className="rounded-lg border border-blue-100 bg-gradient-to-br from-white to-blue-50/70 p-5">
        <div className="mb-4 flex items-center gap-2">
          <div className="size-3 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600" />
          <div className="h-3 w-36 animate-pulse rounded-full bg-blue-200/80" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="rounded-lg border border-blue-100 bg-white/80 p-3"
            >
              <div className="mb-3 h-2.5 w-20 animate-pulse rounded-full bg-slate-200" />
              <div className="h-6 w-12 animate-pulse rounded-md bg-gradient-to-r from-indigo-200 to-blue-200" />
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {[0, 1].map((index) => (
            <div
              key={index}
              className="h-36 overflow-hidden rounded-lg border border-blue-100 bg-white/80 p-4"
            >
              <div className="mb-5 h-3 w-32 animate-pulse rounded-full bg-slate-200" />
              <div className="flex h-20 items-end gap-3">
                {[44, 70, 54, 86].map((height, barIndex) => (
                  <div
                    key={barIndex}
                    className="w-full animate-pulse rounded-t-md bg-gradient-to-t from-blue-500/70 to-indigo-400/60"
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {detail ??
            "The agent is composing the surface. Cards and charts appear as soon as their streamed component data is parseable."}
        </p>
      </div>
    </A2UIStreamingFrame>
  );
}

function buildA2UIOperations(surfaceId: string, components: A2UIComponent[]) {
  return [
    {
      version: "v0.9",
      createSurface: {
        surfaceId,
        catalogId: CONTROL_ROOM_A2UI_CATALOG_ID,
      },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId,
        components,
      },
    },
  ];
}

type A2UIComponent = Record<string, unknown> & {
  id: string;
  component: string;
  children?: string[];
};

function getRenderableA2UIComponents(
  args: Record<string, unknown> | undefined,
): A2UIComponent[] {
  const rawComponents = args?.components;
  if (!Array.isArray(rawComponents)) return [];

  const ids = new Set<string>();
  const components = rawComponents
    .filter(
      (component): component is Record<string, unknown> =>
        !!component && typeof component === "object",
    )
    .map<A2UIComponent>((component) => ({
      ...component,
      id: typeof component.id === "string" ? component.id : "",
      component:
        typeof component.component === "string" ? component.component : "",
    }))
    .filter((component) => {
      if (!component.id || !component.component || ids.has(component.id)) {
        return false;
      }
      ids.add(component.id);
      return true;
    });

  const sanitized = components.map((component) => {
    if (!Array.isArray(component.children)) return component;
    return {
      ...component,
      children: component.children.filter(
        (child): child is string => typeof child === "string" && ids.has(child),
      ),
    };
  });

  const hasRoot = sanitized.some((component) => component.id === "root");
  if (!hasRoot || sanitized.length < 2) return [];

  return sanitized;
}

function getComponentCount(args: Record<string, unknown> | undefined) {
  return Array.isArray(args?.components) ? args.components.length : 0;
}

function getOperationSurfaceId(operation: unknown): string | null {
  if (!operation || typeof operation !== "object") return null;
  const record = operation as Record<string, any>;
  return (
    (typeof record.surfaceId === "string" ? record.surfaceId : null) ??
    record.createSurface?.surfaceId ??
    record.updateComponents?.surfaceId ??
    record.updateDataModel?.surfaceId ??
    record.deleteSurface?.surfaceId ??
    null
  );
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
    <Card
      size="sm"
      className="my-2 max-w-3xl rounded-xl py-3 shadow-none ring-border opacity-75"
    >
      <details>
        <summary className="cursor-pointer list-none">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="mr-auto text-sm">
                Harness event · {name}
              </CardTitle>
              <Badge
                variant="outline"
                className={
                  statusTone === "emerald"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : statusTone === "amber"
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : statusTone === "cyan"
                        ? "border-cyan-200 bg-cyan-50 text-cyan-700"
                        : undefined
                }
              >
                {status}
              </Badge>
            </div>
          </CardHeader>
        </summary>
        <CardContent className="space-y-3">
          {args !== undefined && (
            <section className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                args
              </div>
              <CodeBlock
                code={JSON.stringify(args, null, 2)}
                language="json"
                maxHeight={180}
              />
            </section>
          )}
          {result !== undefined && (
            <section className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                result
              </div>
              <CodeBlock
                code={
                  typeof result === "string"
                    ? result
                    : JSON.stringify(result, null, 2)
                }
                language="json"
                maxHeight={220}
              />
            </section>
          )}
        </CardContent>
      </details>
    </Card>
  );
}
