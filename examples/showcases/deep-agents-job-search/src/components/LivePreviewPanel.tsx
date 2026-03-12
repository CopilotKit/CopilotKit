"use client";

import { useDefaultTool } from "@copilotkit/react-core";
import { ChevronRight, Wrench, CheckCircle2, Loader2 } from "lucide-react";

export function LivePreviewPanel() {
  useDefaultTool({
    render: ({ name, status, args, result }) => {
      const isComplete = status === "complete";

      return (
        <details className="group rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
            <div className="flex items-center gap-2 min-w-0">
              <span className="grid h-8 w-8 place-items-center rounded-md bg-slate-100 text-slate-700">
                <Wrench className="h-4 w-4" />
              </span>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-slate-900">
                    {name}
                  </span>

                  <span
                    className={[
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      isComplete
                        ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                        : "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
                    ].join(" ")}
                  >
                    {isComplete ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Complete
                      </>
                    ) : (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Running
                      </>
                    )}
                  </span>
                </div>

                <div className="text-xs text-slate-600">
                  {isComplete ? "Called tool" : "Calling tool"}
                </div>
              </div>
            </div>

            <ChevronRight className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-90" />
          </summary>

          <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 space-y-3">
            <Row label="Status">
              <span className="text-xs font-medium text-slate-800">{status}</span>
            </Row>

            <Row label="Args">
              <CodeBlock value={args} />
            </Row>

            <Row label="Result">
              <CodeBlock value={result} />
            </Row>
          </div>
        </details>
      );
    },
  });

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-lg border border-slate-200 overflow-hidden">
        <div className="bg-linear-to-r from-purple-600 to-purple-700 px-6 py-4">
          <h2 className="text-xl font-semibold text-white">Tool Calls</h2>
          <p className="text-purple-100 text-sm">
            Tool calls will appear inside the chat stream.
          </p>
        </div>

        <div className="max-h-[600px] overflow-y-auto p-6 space-y-3">
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center">
            <p className="text-sm font-medium text-slate-900">
              Waiting for tool calls…
            </p>
            <p className="text-sm text-slate-600">
              Expand a call to inspect args + result.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-slate-700">{label}</div>
      {children}
    </div>
  );
}

function CodeBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white p-3 text-[12px] leading-relaxed text-slate-900">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
