import { Check, MessageSquare, PlusCircle, Send, X } from "lucide-react";
import { Transaction } from "@/app/api/v1/data";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

interface ApprovalInterfaceProps {
  onApprove?: (transactionId: string) => void;
  onDeny?: (transactionId: string) => void;
}

interface TransactionsListProps {
  transactions: Transaction[];
  compact?: boolean;
  showApprovalInterface?: boolean;
  approvalInterfaceProps?: ApprovalInterfaceProps;
}

export function TransactionsList({
  transactions,
  compact = false,
  showApprovalInterface = false,
  approvalInterfaceProps = {},
}: TransactionsListProps) {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 3000);

    // Cleanup the timer on component unmount
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div
        className={cn(
          "border rounded-lg overflow-hidden p-4",
          compact ? "text-sm" : "text-base"
        )}
      >
        Fetching data...
      </div>
    );
  }

  return (
    <div
      className={cn(
        "border rounded-lg overflow-hidden",
        compact ? "text-sm" : "text-base"
      )}
    >
      {transactions.map((transaction, index) => (
        <div key={transaction.id}>
          <div className={cn("flex items-center p-4", compact ? "p-3" : "p-4")}>
            <div
              className={cn(
                "rounded-full flex items-center justify-center mr-4",
                transaction.amount > 0 ? "bg-green-500" : "bg-red-500",
                compact ? "w-6 h-6" : "w-8 h-8"
              )}
            >
              {transaction.amount > 0 ? (
                <PlusCircle
                  className={cn("text-white", compact ? "h-3 w-3" : "h-4 w-4")}
                />
              ) : (
                <Send
                  className={cn("text-white", compact ? "h-3 w-3" : "h-4 w-4")}
                />
              )}
            </div>
            <div className="flex-1 space-y-1">
              <p
                className={cn(
                  "font-medium leading-tight",
                  compact ? "text-xs" : "text-sm"
                )}
              >
                {transaction.title}
              </p>
              <p
                className={cn(
                  "text-neutral-500 dark:text-neutral-400 leading-tight",
                  compact ? "text-xs" : "text-sm"
                )}
              >
                {transaction.date}
              </p>
            </div>
            <div
              className={cn(
                transaction.amount > 0 ? "text-green-500" : "text-red-500",
                compact ? "text-sm" : "text-base"
              )}
            >
              {transaction.amount > 0 ? "+" : ""}
              {transaction.amount.toFixed(2)}
            </div>
          </div>
          {transaction.note && (
            <div
              className={cn(
                "bg-neutral-100 dark:bg-neutral-800 p-3 flex items-start",
                compact ? "p-2" : "p-3"
              )}
            >
              <MessageSquare
                className={cn(
                  "text-neutral-500 dark:text-neutral-400 mr-2 flex-shrink-0",
                  compact ? "h-3 w-3 mt-0.5" : "h-4 w-4 mt-1"
                )}
              />
              <div className="flex-1">
                <p
                  className={cn(
                    "text-neutral-700 dark:text-neutral-300",
                    compact ? "text-xs" : "text-sm"
                  )}
                >
                  {transaction.note.content}
                </p>
                <p
                  className={cn(
                    "text-neutral-500 dark:text-neutral-400 mt-1",
                    compact ? "text-xs" : "text-sm"
                  )}
                >
                  {transaction.note.date}
                </p>
              </div>
            </div>
          )}
          {showApprovalInterface && transaction.status === "pending" && (
            <div className="flex items-center justify-center space-x-4 rounded-lg bg-white p-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  approvalInterfaceProps?.onApprove?.(transaction.id)
                }
                aria-label="Approve"
                className="h-12 w-12 rounded-full bg-green-50 text-green-600 hover:bg-green-100 hover:text-green-700 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30 dark:hover:text-green-300"
              >
                <Check className="h-6 w-6" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => approvalInterfaceProps?.onDeny?.(transaction.id)}
                aria-label="Deny"
                className="h-12 w-12 rounded-full bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
              >
                <X className="h-6 w-6" />
              </Button>
            </div>
          )}
          {index < transactions.length - 1 && <Separator className="my-0" />}
        </div>
      ))}
    </div>
  );
}
