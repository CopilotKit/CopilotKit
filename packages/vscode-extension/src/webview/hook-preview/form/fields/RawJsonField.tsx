import { useState } from "react";
import type { FormField } from "../schema/types";

/**
 * Editable JSON textarea. Local text state is seeded from `value` on mount and
 * does not re-sync on subsequent external `value` changes — acceptable for the
 * hook preview panel today, which treats this as a user-driven input only.
 * If callers start resetting values externally, sync on blur-out via a ref.
 */
export function RawJsonField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { kind: "raw-json" }>;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `field-${field.name}`;
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    // Empty input means "no change" — don't clobber the prior value with {}.
    // A raw-json field may hold an array, string, or null, and silently
    // overwriting it with {} would be surprising.
    if (text.trim() === "") {
      setError(null);
      return;
    }
    try {
      const parsed = JSON.parse(text);
      setError(null);
      onChange(parsed);
    } catch (e) {
      setError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="hook-field hook-field-rawjson">
      <label htmlFor={id} className="hook-field-label">
        {field.label}
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        rows={8}
        aria-invalid={error !== null}
      />
      {field.hint ? (
        <small className="hook-field-desc">{field.hint}</small>
      ) : null}
      {error ? (
        <span role="alert" className="hook-field-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
