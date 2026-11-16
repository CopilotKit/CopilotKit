import type { ReactNode } from "react";

/** The rail the Get started page hangs on: markers in a 28px column, the rail line through their centres. */
export const RAIL = "relative grid grid-cols-[28px_1fr] gap-x-4";
export const RAIL_LINE = "absolute bottom-1 left-[13.5px] top-9 w-px bg-border";
export const MARKER =
  "grid size-7 place-items-center rounded-full bg-foreground font-mono text-[12px] font-medium text-background dark:bg-white/[0.12] dark:text-foreground dark:ring-1 dark:ring-inset dark:ring-white/[0.08]";
export const STEP_TITLE =
  "text-[16px] font-semibold leading-snug tracking-[-0.01em] text-foreground";

/**
 * Numbered steps on the page's rail: a short title, at most one line of help, then the thing to do. `start`:
 * the number of the first, so the setup steps carry on after the library (step 1) and the setup path (step 2).
 */
export function Steps({
  steps,
  start = 1,
  rise,
}: {
  steps: Array<{ title: ReactNode; help?: ReactNode; body?: ReactNode }>;
  start?: number;
  /** Arrive with the page's waterfall (`wb-rise`): the first step's place in it, the rest one apiece after. */
  rise?: number;
}) {
  return (
    <ol className="flex flex-col" start={start}>
      {steps.map((s, i) => (
        <li
          key={i}
          className={`${RAIL} pb-9 last:pb-0${rise === undefined ? "" : " wb-rise"}`}
          style={
            rise === undefined
              ? undefined
              : ({ "--rise": rise + i } as React.CSSProperties)
          }
        >
          {i < steps.length - 1 ? (
            <span aria-hidden className={RAIL_LINE} />
          ) : null}
          <span aria-hidden className={MARKER}>
            {start + i}
          </span>
          <div className="min-w-0 pt-[3px]">
            <h3 className={STEP_TITLE}>{s.title}</h3>
            {s.help ? (
              <p className="mt-1 max-w-[64ch] text-[14px] leading-relaxed text-muted-foreground">
                {s.help}
              </p>
            ) : null}
            {s.body ? <div className="mt-3">{s.body}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
