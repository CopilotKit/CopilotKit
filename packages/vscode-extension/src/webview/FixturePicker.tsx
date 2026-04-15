import React from "react";

interface FixturePickerProps {
  fixtures: string[];
  active: string;
  onSelect: (name: string) => void;
}

export function FixturePicker({
  fixtures,
  active,
  onSelect,
}: FixturePickerProps): React.ReactElement | null {
  if (fixtures.length <= 1) return null;

  return (
    <div
      style={{
        padding: "8px 12px",
        borderBottom: "1px solid var(--vscode-panel-border)",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontFamily: "var(--vscode-font-family)",
        fontSize: "var(--vscode-font-size)",
      }}
    >
      <label
        htmlFor="fixture-picker"
        style={{ color: "var(--vscode-foreground)", opacity: 0.8 }}
      >
        Fixture:
      </label>
      <select
        id="fixture-picker"
        value={active}
        onChange={(e) => onSelect(e.target.value)}
        style={{
          background: "var(--vscode-dropdown-background)",
          color: "var(--vscode-dropdown-foreground)",
          border: "1px solid var(--vscode-dropdown-border)",
          borderRadius: "2px",
          padding: "2px 8px",
          fontFamily: "inherit",
          fontSize: "inherit",
        }}
      >
        {fixtures.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
