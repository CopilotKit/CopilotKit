import type { Card as ICard } from "@/app/api/v1/data";
import { CardBrand } from "@/app/api/v1/data";
import { cn } from "@/lib/utils";

/** Inline VISA wordmark (white), for use on the dark gradient card face. */
export function VisaWordmark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 780 500"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Visa"
    >
      <path
        fill="currentColor"
        d="M293.2 348.7l33.4-195.8h53.4l-33.4 195.8zM540.7 157.2c-10.6-4-27.2-8.3-47.9-8.3-52.8 0-90 26.6-90.2 64.6-.3 28.1 26.5 43.8 46.8 53.2 20.8 9.6 27.8 15.7 27.7 24.3-.1 13.1-16.6 19.1-32 19.1-21.4 0-32.7-3-50.3-10.2l-6.9-3.1-7.5 43.8c12.5 5.5 35.6 10.2 59.6 10.5 56.2 0 92.6-26.3 93-66.8.2-22.3-14-39.2-44.8-53.2-18.6-9.1-30.1-15.1-30-24.3 0-8.1 9.7-16.8 30.6-16.8 17.4-.3 30.1 3.5 39.9 7.5l4.8 2.3 7.2-42.7zM676.3 152.9h-41.3c-12.8 0-22.4 3.5-28 16.3l-79.4 179.5h56.2s9.2-24.2 11.3-29.5c6.1 0 60.8.1 68.6.1 1.6 6.9 6.5 29.4 6.5 29.4h49.7l-43.6-195.8zm-65.8 126.3c4.4-11.3 21.4-54.8 21.4-54.8-.3.5 4.4-11.4 7.1-18.8l3.6 17s10.3 47 12.4 56.6h-44.5zM232.2 152.9L180 283.6l-5.6-27c-9.7-31.2-39.9-65-73.7-81.9l47.9 173.8h56.6l84.2-195.6h-57.2"
      />
      <path
        fill="currentColor"
        opacity="0.85"
        d="M131.9 152.9H46.3l-.7 3.8c67.1 16.2 111.5 55.4 129.9 102.5L157.2 169c-3.2-12.5-12.7-15.7-25.3-16.1"
      />
    </svg>
  );
}

/** Overlapping-circles Mastercard mark. */
export function MastercardMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 780 500"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Mastercard"
    >
      <circle cx="312" cy="250" r="200" fill="#eb001b" />
      <circle cx="468" cy="250" r="200" fill="#f79e1b" />
      <path
        d="M390 100.2c-49.7 38.3-81.6 98.1-81.6 165.8s31.9 127.5 81.6 165.8c49.7-38.3 81.6-98.1 81.6-165.8S439.7 138.5 390 100.2z"
        fill="#ff5f00"
      />
    </svg>
  );
}

/**
 * The vivid violet→indigo gradient credit card face. Purely presentational.
 * Shows a masked number, holder, valid-thru and brand mark. `subtle` renders a
 * dimmed/peeking variant for a card stacked behind the active one.
 */
export function GradientCreditCard({
  card,
  holder,
  subtle = false,
  className,
}: {
  card: Pick<ICard, "last4" | "expiry" | "type">;
  holder: string;
  subtle?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex aspect-[1.586/1] min-h-[185px] w-full overflow-hidden rounded-[22px] p-5 text-white @container",
        subtle
          ? "bg-gradient-to-br from-indigo-400/80 to-violet-500/80"
          : "brand-gradient shadow-[0_16px_38px_hsl(252_83%_55%/0.34)]",
        className,
      )}
    >
      {/* Soft sheen + decorative orbs for depth. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-white/15 blur-xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -left-10 h-44 w-44 rounded-full bg-white/10 blur-xl"
      />

      <div className="relative flex h-full min-w-0 flex-1 flex-col justify-between gap-3">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-2">
            {/* EMV chip */}
            <div className="h-7 w-10 rounded-md bg-gradient-to-br from-amber-200 to-amber-400/80 shadow-inner" />
          </div>
          {card.type === CardBrand.Visa ? (
            <VisaWordmark className="h-7 w-auto text-white" />
          ) : (
            <MastercardMark className="h-9 w-auto" />
          )}
        </div>

        <div className="space-y-3">
          {/* Masked PAN. `clamp()` + nowrap keeps all four groups on a single
             line at every card width (the wide dashboard hero AND the narrow
             /-page cards) without ever wrapping or clipping the last group. */}
          <p
            className="whitespace-nowrap font-mono tracking-[0.16em] text-white/95"
            style={{ fontSize: "clamp(0.95rem, 4.8cqw, 1.125rem)" }}
          >
            ••••&nbsp;••••&nbsp;••••&nbsp;{card.last4}
          </p>
          <div className="flex items-end justify-between text-xs">
            <div>
              <p className="uppercase tracking-wide text-white/60">
                Card holder
              </p>
              <p className="mt-0.5 text-sm font-medium tracking-wide">
                {holder}
              </p>
            </div>
            <div className="text-right">
              <p className="uppercase tracking-wide text-white/60">
                Valid thru
              </p>
              <p className="mt-0.5 text-sm font-medium tracking-wide">
                {card.expiry}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
