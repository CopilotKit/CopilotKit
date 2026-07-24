/**
 * `MrrCard` — a presentational MRR summary card, authored as plain host-tag JSX
 * with **Tailwind** classes (CopilotKit brand tokens from styles/tailwind.css).
 * The compiled brand stylesheet + Plus Jakarta Sans are fed to
 * `createChannel({ render })`, and Takumi resolves the classes when it rasterizes.
 *
 * Return type is `ChannelNode` (what `JSX.Element` is under the channels pragma);
 * the runtime value is a React element, which `thread.post` rasterizes.
 */
import type { ChannelNode } from "@copilotkit/channels";

export interface MrrCardProps {
  value: string;
  delta: number;
}

export function MrrCard({ value, delta }: MrrCardProps): ChannelNode {
  const up = delta >= 0;
  return (
    <div className="flex flex-col gap-2 w-full h-full p-8 bg-brand-bg rounded-2xl font-brand">
      <span className="text-base text-brand-muted">
        Monthly recurring revenue
      </span>
      <span className="text-[56px] font-bold text-brand-ink">{value}</span>
      <span
        className={`text-[22px] font-bold ${up ? "text-brand-mint-deep" : "text-[#d92d20]"}`}
      >
        {`${up ? "+" : "-"}${Math.abs(delta)}%`}
      </span>
    </div>
  );
}
