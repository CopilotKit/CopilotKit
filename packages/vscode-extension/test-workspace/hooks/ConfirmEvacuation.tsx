// @ts-nocheck — demo fixture; react-core types are stricter than the stubs need.
// Demonstrates V2 `useHumanInTheLoop` — render shape is action-like, but the
// flow requires the human to confirm before the action proceeds. Fixture is
// an evacuation-order confirmation UI with Accept / Deny pathways.
import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { z } from "zod";

export function ConfirmEvacuation() {
  useHumanInTheLoop({
    name: "confirmEvacuation",
    description: "Require human approval before issuing an evacuation order",
    parameters: z.object({
      area: z.string(),
      reason: z.string(),
      windSpeed: z.number().optional(),
    }),
    render: ({ args, status, respond }) => (
      <div className="overflow-hidden rounded-2xl border border-rose-500/30 bg-gradient-to-b from-rose-950/40 via-black to-black text-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-white/5 bg-gradient-to-b from-rose-500/10 to-transparent px-5 py-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-500/20 text-2xl">
            🌪️
          </div>
          <div className="flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-rose-300/80">
              Human approval required
            </div>
            <h3 className="mt-1 text-lg font-bold">
              Evacuation order — {args?.area ?? "—"}
            </h3>
          </div>
          <span
            className={
              "self-start rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
              (status === "complete"
                ? "bg-emerald-400/20 text-emerald-200"
                : "bg-rose-500/20 text-rose-200")
            }
          >
            {status}
          </span>
        </div>
        <div className="px-5 py-4 text-sm text-white/80">
          <p className="leading-relaxed">
            {args?.reason ??
              "Sustained high winds exceeding safe thresholds for mobile homes and unsecured structures."}
          </p>
          {typeof args?.windSpeed === "number" ? (
            <p className="mt-3 inline-flex items-center gap-2 rounded-md border border-rose-400/20 bg-rose-500/10 px-2.5 py-1 text-xs">
              <span className="font-semibold text-rose-200">
                {args.windSpeed} mph
              </span>
              <span className="text-white/60">sustained winds</span>
            </p>
          ) : null}
        </div>
        <div className="flex gap-2 border-t border-white/5 bg-black/20 px-5 py-3">
          <button
            type="button"
            onClick={() => respond?.({ ok: false })}
            className="flex-1 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => respond?.({ ok: true })}
            className="flex-1 rounded-md bg-rose-500 px-3 py-2 text-sm font-semibold text-white shadow-lg shadow-rose-500/40 transition hover:bg-rose-400"
          >
            Approve &amp; issue order
          </button>
        </div>
      </div>
    ),
  });
  return null;
}

export default ConfirmEvacuation;
