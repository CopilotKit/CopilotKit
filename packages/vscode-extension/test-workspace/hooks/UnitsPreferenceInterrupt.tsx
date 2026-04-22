// @ts-nocheck — demo fixture; react-core types are stricter than the stubs need.
// Demonstrates V2 `useInterrupt` — nameless interrupt-shaped hook. Fixture is
// a preferred-units prompt (Celsius / Fahrenheit / Kelvin) that pauses the
// agent flow until the user picks one.
import { useInterrupt } from "@copilotkit/react-core/v2";

export function UnitsPreferenceInterrupt() {
  useInterrupt({
    render: ({ event, resolve }) => {
      const e = (event ?? {}) as { value?: { question?: string } };
      const question =
        e.value?.question ?? "Which temperature units do you prefer?";
      const options: Array<{
        key: "celsius" | "fahrenheit" | "kelvin";
        label: string;
        glyph: string;
      }> = [
        { key: "celsius", label: "Celsius", glyph: "°C" },
        { key: "fahrenheit", label: "Fahrenheit", glyph: "°F" },
        { key: "kelvin", label: "Kelvin", glyph: "K" },
      ];
      return (
        <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-indigo-950/40 to-black shadow-xl">
          <div className="border-b border-white/5 bg-gradient-to-b from-indigo-500/10 to-transparent px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-indigo-300/80">
              Paused · awaiting input
            </div>
            <div className="mt-1 text-base font-semibold text-white">
              {question}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 p-4">
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => resolve?.(o.key)}
                className="group flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] px-2 py-3 text-white transition hover:border-indigo-400/60 hover:bg-indigo-500/10"
              >
                <span className="text-2xl font-bold text-white/90 group-hover:text-indigo-200">
                  {o.glyph}
                </span>
                <span className="text-[11px] uppercase tracking-wider text-white/60 group-hover:text-white/90">
                  {o.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      );
    },
  });
  return null;
}

export default UnitsPreferenceInterrupt;
