import { cn } from "@/lib/utils";
import { getStatusColor } from "@/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
        getStatusColor(status),
      )}
    >
      {status.replace("-", " ")}
    </span>
  );
}
