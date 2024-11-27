import { SearchProgress as SearchProgressType } from "@/lib/types";
import { Card } from "./ui/card";
import { LoaderCircle, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SearchProgressProps = {
  className?: string;
  progress?: SearchProgressType[];
}

export function SearchProgressItem({ progress }: { progress: SearchProgressType }) {
    return <Card className="p-4 flex items-center gap-2">
        {progress.done ? (
            <CheckIcon className="w-4 h-4 text-green-500 bg-green-500/20 rounded-full p-0.5" />
        ) : (
            <LoaderCircle className="w-4 h-4 text-muted-foreground bg-muted-foreground/20 rounded-full p-1 animate-spin" />
        )}
        <p className="text-sm font-medium capitalize">
            {progress.query}
        </p>
    </Card>
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
