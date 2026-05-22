/**
 * M4 — ArgForm: render a `ParameterDescriptor[]` as an editable form, emit
 * args back via `onChange` on every keystroke / item change.
 *
 * Recursive shape: a parent <ArgForm> renders a <Field> per descriptor. The
 * "object" case recurses with another <ArgForm> at the nested level. The
 * "array" case manages a list of items, each rendered via <Field> against the
 * descriptor's `itemType`.
 *
 * Styling: inline-style objects to match the existing M0/M1 SPA convention
 * (see `App.tsx`). Tailwind plumbing is deferred to M2/M8 per the execution
 * plan — keeping this file framework-light makes the future Tailwind swap a
 * straight class-name substitution.
 *
 * Opaque-type contract:
 *   - The textarea editor maintains a *string buffer* alongside the parsed
 *     value. On blur, we try `JSON.parse(buffer)`. On success we emit a new
 *     args object via `onChange`. On failure we surface the error inline and
 *     DO NOT call `onChange` — meeting M4 exit criterion 4.
 *
 * Spec: .chalk/plans/web-inspector-v1.md §7.1 + execution plan §4 (Agent C).
 */
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";

import type { ParameterDescriptor } from "../../shared/types.js";

import {
  defaultForDescriptor,
  descriptorToDefaults,
} from "../lib/descriptor-to-form.js";

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export type ArgFormProps = {
  parameters: ParameterDescriptor[];
  /** Current aggregated args. Treated as a `Record<string, unknown>` shaped
   *  to match `parameters`. Unknown extras pass through unchanged. */
  value: unknown;
  onChange: (next: unknown) => void;
};

/**
 * Top-level form renderer. Each parameter becomes one <Field>; nested objects
 * recurse via another <ArgForm>. Emits the aggregated args object on every
 * change.
 */
export function ArgForm({
  parameters,
  value,
  onChange,
}: ArgFormProps): ReactElement {
  const record = asRecord(value);

  const updateField = (name: string, next: unknown) => {
    const merged: Record<string, unknown> = { ...record, [name]: next };
    onChange(merged);
  };

  if (parameters.length === 0) {
    return (
      <p style={styles.empty}>
        This tool declares no parameters. The agent invokes it with no args.
      </p>
    );
  }

  return (
    <div style={styles.form}>
      {parameters.map((param) => (
        <Field
          key={param.name}
          descriptor={param}
          value={record[param.name]}
          onChange={(next) => updateField(param.name, next)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single-field renderer
// ---------------------------------------------------------------------------

type FieldProps = {
  descriptor: ParameterDescriptor;
  value: unknown;
  onChange: (next: unknown) => void;
  /** Hide the label row; used for array items where the row itself is labeled. */
  hideLabel?: boolean;
};

function Field({
  descriptor,
  value,
  onChange,
  hideLabel,
}: FieldProps): ReactElement {
  const inputId = useId();

  return (
    <div style={styles.field}>
      {hideLabel ? null : (
        <FieldLabel descriptor={descriptor} htmlFor={inputId} />
      )}
      <FieldControl
        descriptor={descriptor}
        value={value}
        onChange={onChange}
        inputId={inputId}
      />
      {descriptor.description ? (
        <p style={styles.description}>{descriptor.description}</p>
      ) : null}
    </div>
  );
}

function FieldLabel({
  descriptor,
  htmlFor,
}: {
  descriptor: ParameterDescriptor;
  htmlFor: string;
}): ReactElement {
  return (
    <label htmlFor={htmlFor} style={styles.label}>
      <span style={styles.labelText}>{descriptor.name}</span>
      {descriptor.required ? (
        <span aria-label="required" style={styles.required}>
          *
        </span>
      ) : null}
      <span style={styles.typeChip}>{describeType(descriptor)}</span>
    </label>
  );
}

function describeType(descriptor: ParameterDescriptor): string {
  switch (descriptor.type) {
    case "array":
      return `array<${describeType(
        descriptor.itemType ?? { name: "", type: "opaque", required: false },
      )}>`;
    case "enum":
      return `enum`;
    case "object":
      return `object`;
    default:
      return descriptor.type;
  }
}

// ---------------------------------------------------------------------------
// Per-type controls
// ---------------------------------------------------------------------------

function FieldControl({
  descriptor,
  value,
  onChange,
  inputId,
}: {
  descriptor: ParameterDescriptor;
  value: unknown;
  onChange: (next: unknown) => void;
  inputId: string;
}): ReactElement {
  switch (descriptor.type) {
    case "string":
      return <StringControl id={inputId} value={value} onChange={onChange} />;
    case "number":
      return <NumberControl id={inputId} value={value} onChange={onChange} />;
    case "boolean":
      return <BooleanControl id={inputId} value={value} onChange={onChange} />;
    case "enum":
      return (
        <EnumControl
          id={inputId}
          values={descriptor.enumValues ?? []}
          value={value}
          onChange={onChange}
        />
      );
    case "array":
      return (
        <ArrayControl
          itemType={descriptor.itemType}
          value={value}
          onChange={onChange}
        />
      );
    case "object":
      return (
        <ObjectControl
          properties={descriptor.properties ?? []}
          value={value}
          onChange={onChange}
        />
      );
    case "opaque":
      return <OpaqueControl id={inputId} value={value} onChange={onChange} />;
    default: {
      const _exhaustive: never = descriptor.type;
      void _exhaustive;
      return <OpaqueControl id={inputId} value={value} onChange={onChange} />;
    }
  }
}

function StringControl({
  id,
  value,
  onChange,
}: {
  id: string;
  value: unknown;
  onChange: (next: string) => void;
}): ReactElement {
  return (
    <input
      id={id}
      type="text"
      style={styles.input}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function NumberControl({
  id,
  value,
  onChange,
}: {
  id: string;
  value: unknown;
  onChange: (next: number) => void;
}): ReactElement {
  // We keep a local string buffer so users can type partial values like "-"
  // or "." without us snapping the underlying number prematurely. On every
  // valid parse we emit; on invalid input we hold the buffer but don't emit.
  const initial = typeof value === "number" ? String(value) : "";
  const [buffer, setBuffer] = useState(initial);

  // Sync buffer when the prop value changes from outside (e.g. preset load).
  useEffect(() => {
    setBuffer(typeof value === "number" ? String(value) : "");
  }, [value]);

  return (
    <input
      id={id}
      type="number"
      style={styles.input}
      value={buffer}
      onChange={(e) => {
        const raw = e.target.value;
        setBuffer(raw);
        if (raw === "" || raw === "-" || raw === "." || raw === "-.") return;
        const parsed = Number(raw);
        if (!Number.isNaN(parsed)) onChange(parsed);
      }}
    />
  );
}

function BooleanControl({
  id,
  value,
  onChange,
}: {
  id: string;
  value: unknown;
  onChange: (next: boolean) => void;
}): ReactElement {
  return (
    <input
      id={id}
      type="checkbox"
      style={styles.checkbox}
      checked={value === true}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

function EnumControl({
  id,
  values,
  value,
  onChange,
}: {
  id: string;
  values: string[];
  value: unknown;
  onChange: (next: string) => void;
}): ReactElement {
  // If no values are declared, degrade to a plain text input — better than a
  // dead empty <select>. M1's schema extractor never emits an empty enum, but
  // defending against it keeps the renderer total.
  if (values.length === 0) {
    return (
      <StringControl
        id={id}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
      />
    );
  }

  const current = typeof value === "string" ? value : values[0];

  return (
    <select
      id={id}
      style={styles.input}
      value={current}
      onChange={(e) => onChange(e.target.value)}
    >
      {values.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );
}

function ArrayControl({
  itemType,
  value,
  onChange,
}: {
  itemType: ParameterDescriptor | undefined;
  value: unknown;
  onChange: (next: unknown[]) => void;
}): ReactElement {
  const items = Array.isArray(value) ? value : [];

  // Fallback when the AST gave us no item type: treat each item as opaque.
  // M4 still renders something usable; M1 normally provides itemType for
  // statically inferable arrays.
  const effectiveItemType: ParameterDescriptor = itemType ?? {
    name: "item",
    type: "opaque",
    required: false,
  };

  const setItem = (index: number, next: unknown) => {
    const copy = items.slice();
    copy[index] = next;
    onChange(copy);
  };

  const removeItem = (index: number) => {
    const copy = items.slice();
    copy.splice(index, 1);
    onChange(copy);
  };

  const addItem = () => {
    onChange([...items, defaultForDescriptor(effectiveItemType)]);
  };

  return (
    <div style={styles.arrayWrap}>
      {items.length === 0 ? (
        <p style={styles.arrayEmpty}>
          No items. Click &ldquo;Add&rdquo; to start.
        </p>
      ) : (
        <ul style={styles.arrayList}>
          {items.map((item, index) => (
            <li
              // Stable across reorders within a single repeater session — the
              // index is fine here because the only mutations are append +
              // remove-at-index. Production polish could swap to a uuid.
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              style={styles.arrayItem}
            >
              <span style={styles.arrayItemIndex}>[{index}]</span>
              <div style={styles.arrayItemBody}>
                <Field
                  hideLabel
                  descriptor={{
                    ...effectiveItemType,
                    name: `${effectiveItemType.name || "item"}[${index}]`,
                  }}
                  value={item}
                  onChange={(next) => setItem(index, next)}
                />
              </div>
              <button
                type="button"
                style={styles.removeButton}
                onClick={() => removeItem(index)}
                aria-label={`Remove item ${index}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" style={styles.addButton} onClick={addItem}>
        + Add item
      </button>
    </div>
  );
}

function ObjectControl({
  properties,
  value,
  onChange,
}: {
  properties: ParameterDescriptor[];
  value: unknown;
  onChange: (next: Record<string, unknown>) => void;
}): ReactElement {
  // Recursive case — render a nested form, but bordered to telegraph the
  // grouping.
  return (
    <div style={styles.objectWrap}>
      <ArgForm
        parameters={properties}
        value={asRecord(value)}
        onChange={(next) => onChange(asRecord(next))}
      />
    </div>
  );
}

function OpaqueControl({
  id,
  value,
  onChange,
}: {
  id: string;
  value: unknown;
  onChange: (next: unknown) => void;
}): ReactElement {
  // Keep two pieces of state:
  //   - `text` — the literal characters in the textarea (user is editing)
  //   - `error` — the most recent JSON.parse error, if any
  // We only call `onChange` when the buffer parses cleanly.
  const [text, setText] = useState(() => stringifyForEditor(value));
  const [error, setError] = useState<string | null>(null);
  const lastEmittedRef = useRef(text);

  // If `value` changes from outside (preset loaded, sibling field updated)
  // and the new value doesn't match what we last emitted, refresh the buffer.
  useEffect(() => {
    const next = stringifyForEditor(value);
    if (next !== lastEmittedRef.current) {
      setText(next);
      setError(null);
      lastEmittedRef.current = next;
    }
  }, [value]);

  const commit = (raw: string) => {
    if (raw.trim() === "") {
      setError(null);
      lastEmittedRef.current = raw;
      onChange(null);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      setError(null);
      lastEmittedRef.current = raw;
      onChange(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      // Per M4 exit criterion 4: do NOT call onChange when JSON is invalid.
    }
  };

  return (
    <div>
      <textarea
        id={id}
        rows={6}
        style={{
          ...styles.textarea,
          ...(error ? styles.textareaError : {}),
        }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        spellCheck={false}
      />
      <div style={styles.opaqueFooter}>
        {error ? (
          <span style={styles.errorText}>JSON error: {error}</span>
        ) : (
          <span style={styles.hint}>JSON (validated on blur)</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringifyForEditor(value: unknown): string {
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

/**
 * Re-export so a parent (M7's App.tsx) can seed initial form state without
 * pulling from `lib/descriptor-to-form.ts` directly.
 */
export { descriptorToDefaults };

// ---------------------------------------------------------------------------
// Styles — inline, matching the M0/M1 SPA convention.
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "0.875rem",
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: 13,
    color: "#111",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  },
  label: {
    display: "flex",
    alignItems: "baseline",
    gap: "0.5rem",
    fontWeight: 500,
    color: "#222",
  },
  labelText: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12.5,
  },
  required: {
    color: "#b22222",
    fontWeight: 700,
  },
  typeChip: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 10.5,
    color: "#7755aa",
    backgroundColor: "#f4eefa",
    padding: "0 0.375rem",
    borderRadius: 3,
    lineHeight: 1.6,
    border: "1px solid #e6d6f5",
  },
  description: {
    margin: 0,
    fontSize: 11.5,
    color: "#666",
    lineHeight: 1.4,
  },
  input: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    padding: "0.375rem 0.5rem",
    border: "1px solid #d4d4d8",
    borderRadius: 4,
    backgroundColor: "#fff",
    color: "#111",
    width: "100%",
    boxSizing: "border-box",
  },
  checkbox: {
    width: 16,
    height: 16,
    margin: 0,
    cursor: "pointer",
  },
  textarea: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12.5,
    padding: "0.5rem",
    border: "1px solid #d4d4d8",
    borderRadius: 4,
    backgroundColor: "#fafafa",
    color: "#111",
    width: "100%",
    boxSizing: "border-box",
    resize: "vertical",
    minHeight: 80,
  },
  textareaError: {
    borderColor: "#b22222",
    backgroundColor: "#fff5f5",
  },
  opaqueFooter: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: "0.25rem",
    fontSize: 11.5,
  },
  hint: {
    color: "#888",
    fontStyle: "italic",
  },
  errorText: {
    color: "#b22222",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  arrayWrap: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    padding: "0.5rem",
    border: "1px dashed #d4d4d8",
    borderRadius: 4,
    backgroundColor: "#fafafa",
  },
  arrayList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  arrayItem: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    gap: "0.5rem",
    alignItems: "start",
    backgroundColor: "#fff",
    padding: "0.375rem 0.5rem",
    borderRadius: 4,
    border: "1px solid #e4e4e7",
  },
  arrayItemIndex: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11.5,
    color: "#7755aa",
    paddingTop: "0.375rem",
  },
  arrayItemBody: {
    minWidth: 0,
  },
  arrayEmpty: {
    margin: 0,
    fontSize: 12,
    color: "#888",
    fontStyle: "italic",
  },
  addButton: {
    alignSelf: "flex-start",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    padding: "0.25rem 0.625rem",
    background: "#0a6f3f",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
  },
  removeButton: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11.5,
    padding: "0.25rem 0.5rem",
    background: "transparent",
    color: "#b22222",
    border: "1px solid #f0c5c5",
    borderRadius: 4,
    cursor: "pointer",
  },
  objectWrap: {
    paddingLeft: "0.75rem",
    borderLeft: "2px solid #e4e4e7",
    marginLeft: "0.125rem",
  },
  empty: {
    margin: 0,
    fontSize: 12.5,
    color: "#888",
    fontStyle: "italic",
  },
};
