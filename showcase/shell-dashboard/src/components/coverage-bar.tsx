"use client";
/**
 * CoverageBar — 6px horizontal bar with green (wired) / amber (stub) /
 * diagonal-stripe gray (unsupported) / gray (unshipped) segments
 * proportional to counts.
 *
 * Unsupported segments use a diagonal-stripe pattern to visually distinguish
 * "framework cannot support" from "just unbuilt" (solid gray background).
 */

export interface CoverageBarProps {
  wired: number;
  stub: number;
  unshipped: number;
  unsupported?: number;
}

const UNSUPPORTED_STRIPES =
  "repeating-linear-gradient(135deg, var(--text-muted) 0, var(--text-muted) 2px, transparent 2px, transparent 4px)";

export function CoverageBar({
  wired,
  stub,
  unshipped,
  unsupported = 0,
}: CoverageBarProps) {
  const total = wired + stub + unshipped + unsupported;
  if (total === 0) return null;

  const pctWired = (wired / total) * 100;
  const pctStub = (stub / total) * 100;
  const pctUnsupported = (unsupported / total) * 100;
  // unshipped fills the rest (solid gray background)

  const titleParts = [
    `${wired} wired`,
    `${stub} stub`,
    `${unshipped} unshipped`,
  ];
  if (unsupported > 0) {
    titleParts.push(`${unsupported} unsupported`);
  }

  return (
    <div
      data-testid="coverage-bar"
      className="w-full h-1.5 rounded-full overflow-hidden flex bg-[var(--text-muted)]/20"
      title={titleParts.join(" / ")}
    >
      {pctWired > 0 && (
        <div
          data-testid="coverage-segment-wired"
          className="h-full bg-[var(--ok)]"
          style={{ width: `${pctWired}%` }}
        />
      )}
      {pctStub > 0 && (
        <div
          data-testid="coverage-segment-stub"
          className="h-full bg-[var(--amber)]"
          style={{ width: `${pctStub}%` }}
        />
      )}
      {pctUnsupported > 0 && (
        <div
          data-testid="coverage-segment-unsupported"
          className="h-full"
          style={{
            width: `${pctUnsupported}%`,
            backgroundImage: UNSUPPORTED_STRIPES,
          }}
        />
      )}
      {/* Gray (unshipped) is the background, so no explicit segment needed */}
    </div>
  );
}
