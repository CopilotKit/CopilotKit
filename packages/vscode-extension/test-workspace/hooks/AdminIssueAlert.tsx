// @ts-nocheck — demo fixture; react-core types are stricter than the stubs need.
// Demonstrates V1 `useCopilotAuthenticatedAction_c` — same render shape as
// useCopilotAction, but only callable by authenticated users. Fixture renders
// a gated "admin-only" alert publication card.
import { useCopilotAuthenticatedAction_c } from "@copilotkit/react-core";

export function AdminIssueAlert() {
  useCopilotAuthenticatedAction_c({
    name: "publishAlert",
    description: "(Admin) Publish a severe-weather alert to subscribers",
    parameters: [
      { name: "headline", type: "string", required: true },
      {
        name: "channel",
        type: "string",
        enum: ["sms", "email", "push", "all"],
        required: true,
      },
    ],
    available: "frontend",
    render: ({ args, status }) => {
      const channel = (args?.channel as string | undefined) ?? "all";
      return (
        <div className="relative overflow-hidden rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-600/20 via-red-600/15 to-fuchsia-700/20 p-6 text-amber-50 shadow-xl">
          <div className="absolute right-4 top-4 flex items-center gap-1.5 rounded-full border border-amber-300/40 bg-black/30 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-200">
            🔒 Admin only
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300/80">
            Broadcast prepared
          </div>
          <h2 className="mt-2 text-2xl font-bold leading-tight">
            {args?.headline ?? "Severe thunderstorm warning"}
          </h2>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-black/30 px-2 py-0.5 text-amber-200">
              channel · {channel}
            </span>
            <span
              className={
                "rounded-full px-2 py-0.5 " +
                (status === "complete"
                  ? "bg-emerald-400/20 text-emerald-200"
                  : "bg-white/10 text-white/70")
              }
            >
              {status}
            </span>
          </div>
        </div>
      );
    },
  });
  return null;
}

export default AdminIssueAlert;
