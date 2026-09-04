"use client";

/**
 * 10px uppercase label + 1px extending line — the dojo section title pattern.
 * See /Users/jerel-cpk/.claude/skills/copilotkit-ui-theme/references/components.md
 */
export function SectionTitle({
  title,
  trailing,
}: {
  title: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 4px",
        marginBottom: 8,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 400,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "#57575b",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </span>
      <div style={{ flex: 1, height: 1, background: "#dbdbe5" }} />
      {trailing}
    </div>
  );
}
