import { useMemo, useState } from "react";
import type { CSSProperties, ReactElement } from "react";

import type { ToolDescriptor } from "../../shared/types.js";

/**
 * Fixture presets sidebar component.
 *
 * Renders one chip per top-level key in `tool.fixtures` and surfaces two
 * actions:
 *
 *   - **Apply** — the user clicks a chip, the component fires `onApply(name,
 *     args)`. The host (M7 integration, currently `App.tsx` once wired up)
 *     forwards the args to the arg form so the user can iterate on them.
 *
 *   - **Save current as preset** — the user types a name into the inline
 *     input and clicks "Save". The component fires `onSave(name, args)`.
 *     `onSave` is responsible for the actual `fixture.save` WS round-trip —
 *     this component is just the UI affordance. The `currentArgs` prop is
 *     the form's current value (i.e. whatever the user has typed); the host
 *     supplies it.
 *
 * The component is intentionally framework-free (plain inline styles, no
 * Tailwind) so it drops into the M0 SPA as-is. M8 polish can replace the
 * styling wholesale without touching the props contract.
 *
 * Props:
 *   - `tool` — the currently-selected `ToolDescriptor`. When `tool.fixtures`
 *     is `null` or empty, the component renders an empty-state hint.
 *   - `onApply(name, args)` — called when the user clicks a preset chip.
 *   - `onSave(name, args)` — called when the user clicks "Save preset". The
 *     handler typically POSTs a `LauncherCommand.fixture.save` over WS.
 *   - `currentArgs` — the form's current value, surfaced when the user
 *     clicks "Save preset". When undefined the save UI is hidden (the host
 *     hasn't wired the form yet — see M7 integration).
 *   - `disableSave` — hide the save UI entirely (e.g. for read-only TS
 *     fixtures the launcher reports back).
 */

export type FixturePresetsProps = {
  tool: ToolDescriptor;
  onApply: (presetName: string, args: unknown) => void;
  onSave?: (presetName: string, args: unknown) => void;
  /** Current form value; required for the "Save current as preset" button. */
  currentArgs?: unknown;
  /** Hide the save UI. Defaults to false. */
  disableSave?: boolean;
};

export function FixturePresets({
  tool,
  onApply,
  onSave,
  currentArgs,
  disableSave = false,
}: FixturePresetsProps): ReactElement {
  // Stable iteration order — JSON.parse preserves the on-disk order, which
  // is what the user committed. We avoid Object.keys() sort to keep
  // "default" first when the user named the first preset that.
  const presetNames = useMemo(() => {
    if (!tool.fixtures) return [];
    return Object.keys(tool.fixtures);
  }, [tool.fixtures]);

  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [newPresetName, setNewPresetName] = useState<string>("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const canSave =
    !disableSave &&
    onSave !== undefined &&
    currentArgs !== undefined &&
    newPresetName.trim().length > 0;

  const handleApply = (name: string): void => {
    if (!tool.fixtures) return;
    setActivePreset(name);
    setSaveError(null);
    onApply(name, tool.fixtures[name]);
  };

  const handleSave = (): void => {
    if (!onSave || currentArgs === undefined) return;
    const trimmed = newPresetName.trim();
    if (trimmed.length === 0) {
      setSaveError("Name the preset before saving.");
      return;
    }
    setSaveError(null);
    onSave(trimmed, currentArgs);
    // Clear the input so the user can save another preset without
    // re-typing. The chip list will update when the launcher's
    // `fixture.changed` broadcast lands and the host re-renders us with a
    // fresh `tool.fixtures`.
    setNewPresetName("");
  };

  return (
    <section style={styles.shell} aria-label="Fixture presets">
      <header style={styles.header}>
        <h2 style={styles.title}>Presets</h2>
        {tool.fixturePath ? (
          <span style={styles.pathHint} title={tool.fixturePath}>
            {truncateMiddle(tool.fixturePath, 56)}
          </span>
        ) : null}
      </header>

      {presetNames.length === 0 ? (
        <EmptyPresetState fixturePath={tool.fixturePath} />
      ) : (
        <ul style={styles.list}>
          {presetNames.map((name) => (
            <li key={name}>
              <button
                type="button"
                style={{
                  ...styles.chip,
                  ...(name === activePreset ? styles.chipActive : {}),
                }}
                onClick={() => handleApply(name)}
                title={`Apply preset "${name}"`}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!disableSave && onSave ? (
        <div style={styles.saveRow}>
          <input
            type="text"
            value={newPresetName}
            placeholder="new-preset-name"
            onChange={(ev) => {
              setNewPresetName(ev.target.value);
              setSaveError(null);
            }}
            style={styles.input}
            aria-label="New preset name"
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && canSave) {
                ev.preventDefault();
                handleSave();
              }
            }}
          />
          <button
            type="button"
            style={{
              ...styles.saveButton,
              ...(canSave ? {} : styles.saveButtonDisabled),
            }}
            disabled={!canSave}
            onClick={handleSave}
            title={
              currentArgs === undefined
                ? "Fill in the form first to save a preset"
                : "Save the current form values as a preset"
            }
          >
            Save preset
          </button>
        </div>
      ) : null}

      {saveError ? (
        <p style={styles.error} role="alert">
          {saveError}
        </p>
      ) : null}
    </section>
  );
}

function EmptyPresetState({
  fixturePath,
}: {
  fixturePath: string | null;
}): ReactElement {
  if (fixturePath) {
    return (
      <p style={styles.empty}>
        Fixture file exists at <code style={styles.code}>{fixturePath}</code>,
        but it has no presets yet. Save one below.
      </p>
    );
  }
  return (
    <p style={styles.empty}>
      No <code style={styles.code}>*.fixture.json</code> alongside this
      component yet. Save a preset to create one.
    </p>
  );
}

/**
 * Truncate a path in the middle (`/foo/.../bar.tsx`) so long workspace
 * paths fit in the header without growing the column.
 */
function truncateMiddle(input: string, max: number): string {
  if (input.length <= max) return input;
  const ellipsis = "...";
  const half = Math.floor((max - ellipsis.length) / 2);
  return `${input.slice(0, half)}${ellipsis}${input.slice(input.length - half)}`;
}

const styles: Record<string, CSSProperties> = {
  shell: {
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: "0.75rem 1rem",
    background: "#fafafa",
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    color: "#111",
    minWidth: 240,
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "0.75rem",
    marginBottom: "0.5rem",
  },
  title: {
    fontSize: "0.875rem",
    fontWeight: 600,
    margin: 0,
    color: "#111",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  pathHint: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
    color: "#777",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  list: {
    listStyle: "none",
    padding: 0,
    margin: "0 0 0.5rem 0",
    display: "flex",
    flexWrap: "wrap",
    gap: "0.375rem",
  },
  chip: {
    appearance: "none",
    border: "1px solid #d1d5db",
    background: "#fff",
    borderRadius: 999,
    padding: "0.25rem 0.75rem",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    color: "#374151",
    cursor: "pointer",
    transition: "background 60ms, border-color 60ms, color 60ms",
  },
  chipActive: {
    background: "#0a6f3f",
    borderColor: "#0a6f3f",
    color: "#fff",
  },
  saveRow: {
    display: "flex",
    gap: "0.375rem",
    marginTop: "0.5rem",
  },
  input: {
    flex: 1,
    padding: "0.3rem 0.5rem",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    border: "1px solid #d1d5db",
    borderRadius: 6,
    background: "#fff",
    color: "#111",
    minWidth: 0,
  },
  saveButton: {
    appearance: "none",
    border: "1px solid #0a6f3f",
    background: "#0a6f3f",
    color: "#fff",
    padding: "0.3rem 0.75rem",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  saveButtonDisabled: {
    background: "#9ca3af",
    borderColor: "#9ca3af",
    cursor: "not-allowed",
  },
  empty: {
    color: "#666",
    fontSize: 12,
    margin: "0 0 0.5rem 0",
    lineHeight: 1.4,
  },
  code: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
    background: "#f3f4f6",
    padding: "0.1rem 0.3rem",
    borderRadius: 4,
    color: "#374151",
  },
  error: {
    color: "#b22222",
    fontSize: 12,
    margin: "0.5rem 0 0 0",
  },
};
