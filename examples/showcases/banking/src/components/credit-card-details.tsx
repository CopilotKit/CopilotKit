import { Lock, Settings2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { GradientCreditCard } from "@/components/card-visual";
import { Progress } from "@/components/ui/progress";
import type { Card as ICard, ExpensePolicy } from "../app/api/v1/data";
import { formatCurrency } from "@/lib/utils";

export function CreditCardDetails({
  card,
  policy,
  holder = "Northwind Finance",
  onChangePinModalOpen,
}: {
  card: ICard;
  policy?: ExpensePolicy;
  /** Cardholder name shown on the card face. */
  holder?: string;
  onChangePinModalOpen: () => void;
}) {
  const usagePct =
    policy && policy.limit > 0
      ? Math.min(100, (policy.spent / policy.limit) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-4 rounded-[26px] border border-hairline bg-surface p-4 shadow-soft transition-shadow hover:shadow-lift">
      <GradientCreditCard card={card} holder={holder.toUpperCase()} />

      {policy ? (
        <div className="space-y-3 px-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-muted">Credit limit</span>
            <span className="font-semibold text-ink">
              {formatCurrency(policy.limit)}
            </span>
          </div>
          <Progress value={usagePct} />
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-muted">Available</span>
            <span className="font-semibold text-positive">
              {formatCurrency(policy.limit - policy.spent)}
            </span>
          </div>
        </div>
      ) : (
        <p className="px-1 text-sm text-ink-muted">
          No expense policy assigned
        </p>
      )}

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full">
            <Settings2 className="mr-2 h-4 w-4" />
            Manage Card
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56">
          <div className="grid gap-3">
            <h4 className="text-sm font-semibold leading-none text-ink">
              Card options
            </h4>
            <div className="h-px w-full bg-hairline" />
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={onChangePinModalOpen}
            >
              <Lock className="mr-2 h-4 w-4" />
              Change PIN
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
