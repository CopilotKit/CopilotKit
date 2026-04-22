// @ts-nocheck — demo fixture; react-core types are stricter than the stubs need.
// Demonstrates V2 `useDefaultRenderTool` — the fallback renderer used for
// any tool call without a more-specific render. Fixture is a generic weather
// data inspector that shows arbitrary incoming args as labeled chips.
import { useDefaultRenderTool } from "@copilotkit/react-core/v2";

export function DefaultWeatherRender() {
  useDefaultRenderTool({
    name: "defaultWeatherFallback",
    render: ({ name, parameters, status }) => {
      const entries = Object.entries(
        (parameters ?? {}) as Record<string, unknown>,
      );
      return (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-neutral-800 to-neutral-900 p-5 shadow-xl">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-white/50">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-yellow-400" />
            Unknown weather tool · fallback renderer
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-lg">
              🌡️
            </div>
            <div>
              <div className="font-mono text-sm text-white/90">
                {name ?? "unknownTool"}
              </div>
              <div className="text-[11px] text-white/50">{status}</div>
            </div>
          </div>
          {entries.length === 0 ? (
            <p className="mt-4 rounded-md border border-dashed border-white/10 bg-white/[0.02] p-3 text-xs text-white/40">
              No parameters passed to this tool call.
            </p>
          ) : (
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
              {entries.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="font-mono text-white/50">{k}</dt>
                  <dd className="truncate font-mono text-sky-200">
                    {JSON.stringify(v)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      );
    },
  });
  return null;
}

export default DefaultWeatherRender;
