import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";

const BAR = "motion-reduce:animate-none";

/** An assistant turn: an avatar and a few lines of reply. */
function Reply({ lines }: { lines: string[] }) {
  return (
    <div className="flex items-start gap-3">
      <Skeleton className={cn("size-7 shrink-0 rounded-full", BAR)} />
      <div className="flex flex-1 flex-col gap-2 pt-1.5">
        {lines.map((width, i) => (
          <Skeleton key={i} className={cn("h-3", width, BAR)} />
        ))}
      </div>
    </div>
  );
}

/** Code: lines of varied length and indent. */
const CODE_LINES = [
  "w-1/3",
  "ms-6 w-1/2",
  "ms-6 w-2/3",
  "ms-12 w-2/5",
  "ms-6 w-1/4",
  "w-1/6",
  "",
  "w-2/5",
  "ms-6 w-3/5",
  "ms-6 w-1/2",
  "w-1/6",
];

/**
 * What a demo window shows while its iframe wakes: the outline of the app
 * it's about to show (a chat, or code), with the status in the composer.
 * After `slow`, the status offers the demo in a new tab instead.
 */
export function DemoSkeleton({
  src,
  slow,
  name = "the demo",
  variant = "chat",
}: {
  /** The page loading, for the new-tab link. */
  src: string;
  /** Show the new-tab link: the demo is taking a while. */
  slow: boolean;
  /** What's waking, in the status: "Waking up {name}". */
  name?: string;
  variant?: "chat" | "code";
}) {
  const status = (
    <p className="truncate" aria-live="polite">
      {slow ? (
        <>
          Still waking up.{" "}
          <a
            href={src}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-primary underline underline-offset-4"
          >
            Open it in a new tab
          </a>
        </>
      ) : (
        `Waking up ${name}`
      )}
    </p>
  );

  if (variant === "code") {
    return (
      <div className="absolute inset-0 flex flex-col bg-card">
        <div
          aria-hidden="true"
          className="flex flex-1 flex-col gap-3 overflow-hidden p-6"
        >
          {CODE_LINES.map((width, i) =>
            width ? (
              <Skeleton key={i} className={cn("h-3", width, BAR)} />
            ) : (
              <div key={i} className="h-3" />
            ),
          )}
        </div>
        <div className="flex items-center gap-2.5 px-6 pb-5 text-sm text-muted-foreground">
          <Spinner className="size-4 shrink-0 text-brand-mint-deep" />
          {status}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      <div
        aria-hidden="true"
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 overflow-hidden px-6 pt-8"
      >
        <Reply lines={["w-4/5", "w-3/5"]} />
        <Skeleton className={cn("ms-auto h-9 w-2/5 rounded-2xl", BAR)} />
        <Reply lines={["w-full", "w-11/12", "w-2/3"]} />
      </div>
      <div className="mx-auto w-full max-w-2xl px-6 pb-6">
        <div className="flex h-12 items-center gap-2.5 rounded-2xl border bg-card px-4 text-sm text-muted-foreground shadow-xs">
          <Spinner className="size-4 shrink-0 text-brand-mint-deep" />
          {status}
        </div>
      </div>
    </div>
  );
}
