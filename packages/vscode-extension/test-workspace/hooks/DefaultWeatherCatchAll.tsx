// @ts-nocheck — demo fixture; react-core types are stricter than the stubs need.
// Demonstrates V2 `useDefaultTool` — registers a catch-all (name: "*")
// frontend action that fires for any tool call without a specific handler.
// Fixture renders an "unknown weather intent" card with the raw payload so
// the user can see what the agent tried to invoke.
import { useDefaultTool } from "@copilotkit/react-core/v2";

export function DefaultWeatherCatchAll() {
  useDefaultTool({
    description:
      "Catch-all handler shown when the agent invokes a tool we haven't registered a dedicated renderer for.",
    render: ({ args, status }) => {
      const entries = Object.entries(
        (args ?? {}) as Record<string, unknown>,
      );
      return (
        <div className="overflow-hidden rounded-2xl border border-amber-400/20 bg-gradient-to-b from-amber-950/40 to-black p-5 text-white shadow-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-500/15 text-2xl">
              ❔
            </div>
            <div className="flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300/80">
                Unhandled weather intent · catch-all
              </div>
              <div className="mt-0.5 text-sm text-white/80">
                The assistant invoked a tool the client doesn&apos;t have a
                dedicated renderer for.
              </div>
            </div>
            <span
              className={
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
                (status === "complete"
                  ? "bg-emerald-400/20 text-emerald-200"
                  : "bg-amber-500/20 text-amber-200")
              }
            >
              {status}
            </span>
          </div>
          {entries.length === 0 ? (
            <p className="mt-4 rounded-md border border-dashed border-amber-400/20 bg-white/[0.02] p-3 text-center text-xs text-white/40">
              No arguments received.
            </p>
          ) : (
            <div className="mt-4 rounded-lg border border-white/5 bg-black/50 font-mono text-xs">
              <div className="border-b border-white/5 px-3 py-1.5 text-[10px] uppercase tracking-widest text-white/40">
                args
              </div>
              <pre className="whitespace-pre-wrap break-words px-3 py-2 text-amber-100/90">
                {JSON.stringify(
                  Object.fromEntries(entries),
                  null,
                  2,
                )}
              </pre>
            </div>
          )}
        </div>
      );
    },
  });
  return null;
}

export default DefaultWeatherCatchAll;
