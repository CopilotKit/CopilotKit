import type { BadgeTone } from "@/lib/status";

export const TONE_CLASS: Record<BadgeTone, string> = {
  green: "text-[var(--ok)]",
  amber: "text-[var(--amber)]",
  red: "text-[var(--danger)]",
  gray: "text-[var(--text-muted)]",
  blue: "text-[var(--accent)]",
};

export const DOT_BG: Record<BadgeTone, string> = {
  green: "bg-[var(--ok)]",
  amber: "bg-[var(--amber)]",
  red: "bg-[var(--danger)]",
  gray: "bg-[var(--text-muted)]",
  blue: "bg-[var(--accent)]",
};

export function Badge({
  name,
  state,
  href,
  title,
}: {
  name: string;
  state: { label: string; tone: BadgeTone };
  href?: string;
  title?: string;
}) {
  const inner = (
    <span className="whitespace-nowrap" title={title}>
      <span className="text-[var(--text-muted)]">{name}</span>{" "}
      <span className={`tabular-nums ${TONE_CLASS[state.tone]}`}>
        {state.label}
      </span>
    </span>
  );
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:underline"
    >
      {inner}
    </a>
  ) : (
    inner
  );
}

export function HealthDot({
  state,
  href,
  title,
}: {
  state: { label: string; tone: BadgeTone };
  href?: string;
  title?: string;
}) {
  const inner = (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap"
      title={title}
    >
      <span
        className={`inline-block w-2 h-2 rounded-full ${DOT_BG[state.tone]}`}
      />
      <span className={`tabular-nums ${TONE_CLASS[state.tone]}`}>
        {state.label}
      </span>
    </span>
  );
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:underline"
    >
      {inner}
    </a>
  ) : (
    inner
  );
}

// Tiny square chip used in strip / grid views.
export function ToneChip({
  tone,
  title,
  label,
}: {
  tone: BadgeTone;
  title?: string;
  label?: string;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center w-4 h-4 rounded-sm text-[9px] font-semibold text-white ${DOT_BG[tone]}`}
      title={title}
    >
      {label ?? ""}
    </span>
  );
}
