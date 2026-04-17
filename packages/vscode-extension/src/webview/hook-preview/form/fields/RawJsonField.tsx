import { useState } from "react";
import type { FormField } from "../schema/types";

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
    try {
      const parsed = text.trim() === "" ? {} : JSON.parse(text);
      setError(null);
      onChange(parsed);
    } catch (e) {
      setError(
        `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
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
