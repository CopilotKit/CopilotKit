/**
 * `MrrCard` — a presentational MRR summary card, authored as plain host-tag JSX
 * with **Tailwind** classes (CopilotKit brand tokens from styles/tailwind.css).
 * The compiled brand stylesheet + Plus Jakarta Sans are fed to
 * `createChannel({ render })`, and Takumi resolves the classes when it rasterizes.
 *
 * The JSX evaluates to a React element (host tags under the channels pragma),
 * which `thread.post` rasterizes to an image.
 */
export interface MrrCardProps {
  value: string;
  delta: number;
}

export function MrrCard({ value, delta }: MrrCardProps) {
  const up = delta >= 0;
  return (
    <div className="flex flex-col gap-2 w-full h-full p-8 bg-brand-bg font-brand">
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
