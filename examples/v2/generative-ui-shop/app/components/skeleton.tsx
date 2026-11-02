/**
 * Thin grey bar used wherever a piece of data hasn't streamed in yet.
 * Render it anywhere the value will be filled in by a partial-streaming
 * field. Pass a tailwind width to control the bar's size.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-3 animate-pulse rounded bg-stone-200 dark:bg-gray-700 ${className}`}
    />
  );
}
