"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { Card as ICard, ExpensePolicy } from "@/app/api/v1/data";
import { CardBrand } from "@/app/api/v1/data";
import { VisaWordmark, MastercardMark } from "@/components/card-visual";
import { cn } from "@/lib/utils";

/** Small bordered brand chip (Visa wordmark / Mastercard mark) shown at the
 *  left of each pickable row. Mirrors the chip used by the "New Card Request"
 *  approval render so the two surfaces read as one design language. */
function BrandChip({ type }: { type: CardBrand }) {
  return (
    <div className="flex h-9 w-12 flex-shrink-0 items-center justify-center rounded-md border border-hairline bg-surface">
      {type === CardBrand.Visa ? (
        <VisaWordmark className="h-4 w-auto text-[#1a1f71]" />
      ) : (
        <MastercardMark className="h-6 w-auto" />
      )}
    </div>
  );
}

/**
 * In-chat card picker. Renders the user's cards as a tappable list — each row
 * shows the brand mark, card type and masked last-4, plus the assigned policy
 * as a subtle subtitle. Clicking a row calls `onSelect(card)` once and then
 * locks the list into a selected/confirmed state (the other rows dim), echoing
 * the one-shot behaviour of <ApprovalButtons/>.
 */
export function CardPicker({
  cards,
  policies = [],
  onSelect,
  heading = "Select a card",
}: {
  cards: ICard[];
  /** Optional — used only to show each card's assigned policy as a subtitle. */
  policies?: ExpensePolicy[];
  onSelect: (card: ICard) => void;
  /** Picker heading; the agent passes a contextual reason (e.g. the policy). */
  heading?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!cards.length) {
    return (
      <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-ink-muted shadow-soft">
        No cards available to choose from.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
      <h3 className="text-sm font-semibold text-ink">{heading}</h3>
      <ul className="space-y-2">
        {cards.map((card) => {
          const policy = policies.find((p) => p.id === card.expensePolicyId);
          const isSelected = selectedId === card.id;
          const isDimmed = selectedId !== null && !isSelected;
          return (
            <li key={card.id}>
              <button
                type="button"
                disabled={selectedId !== null}
                aria-pressed={isSelected}
                onClick={() => {
                  setSelectedId(card.id);
                  onSelect(card);
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 text-left transition-all",
                  isSelected
                    ? "border-brand ring-2 ring-brand ring-offset-1 ring-offset-surface"
                    : "border-hairline hover:border-brand/40 hover:bg-brand-soft",
                  isDimmed && "opacity-50",
                  selectedId === null && "cursor-pointer",
                )}
              >
                <BrandChip type={card.type} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                    <span>{card.type}</span>
                    <span className="font-mono tracking-wider text-ink-muted">
                      •••• {card.last4}
                    </span>
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {policy ? `${policy.type} policy` : "No policy assigned"}
                  </p>
                </div>
                {isSelected && (
                  <Check className="h-5 w-5 flex-shrink-0 text-brand" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {selectedId && (
        <p className="text-xs italic text-ink-muted">Card selected.</p>
      )}
    </div>
  );
}
