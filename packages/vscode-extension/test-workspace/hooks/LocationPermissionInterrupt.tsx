import { useLangGraphInterrupt } from "@copilotkit/react-core";

export function LocationPermissionInterrupt() {
  useLangGraphInterrupt({
    render: ({ event, resolve }) => {
      const e = (event ?? {}) as { value?: { reason?: string } };
      const reason =
        e.value?.reason ??
        "We need your location to provide accurate weather forecasts.";
      return (
        <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-neutral-800 to-neutral-900 shadow-2xl">
          <div className="flex items-center gap-3 border-b border-white/5 bg-gradient-to-b from-sky-500/10 to-transparent px-5 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-500/15 text-xl">
              📍
            </div>
            <div>
              <div className="text-sm font-semibold text-white">
                Share location?
              </div>
              <div className="text-xs text-white/60">
                Weather assistant is requesting permission
              </div>
            </div>
          </div>
          <div className="px-5 py-4 text-sm text-white/80">{reason}</div>
          <div className="flex gap-2 border-t border-white/5 bg-black/20 px-5 py-3">
            <button
              type="button"
              onClick={() => resolve("denied")}
              className="flex-1 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/80 transition hover:bg-white/10"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={() => resolve("granted")}
              className="flex-1 rounded-md bg-sky-500 px-3 py-2 text-xs font-semibold text-white shadow-md shadow-sky-500/30 transition hover:bg-sky-400"
            >
              Allow location
            </button>
          </div>
        </div>
      );
    },
  });
  return null;
}

export default LocationPermissionInterrupt;
