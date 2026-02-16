import { SearchProgress as SearchProgressType } from "@/lib/types";
import { Card } from "./ui/card";
import { LoaderCircle, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SearchProgressProps = {
  className?: string;
  progress?: SearchProgressType[];
};

export function SearchProgressItem({
  progress,
}: {
  progress: SearchProgressType;
}) {
  return (
    <Card className="flex items-center gap-2 p-4">
      {progress.done ? (
        <CheckIcon className="h-4 w-4 rounded-full bg-green-500/20 p-0.5 text-green-500" />
      ) : (
        <LoaderCircle className="h-4 w-4 animate-spin rounded-full bg-muted-foreground/20 p-1 text-muted-foreground" />
      )}
      <p className="text-sm font-medium capitalize">{progress.query}</p>
    </Card>
  );
}

export function SearchProgress({ className, progress }: SearchProgressProps) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {progress?.map((p, i) => (
        <SearchProgressItem key={i} progress={p} />
      ))}
    </div>
  );
}
