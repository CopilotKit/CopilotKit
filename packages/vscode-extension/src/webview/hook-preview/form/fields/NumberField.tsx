import type { FormField } from "../schema/types";

export function NumberField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { kind: "number" }>;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  const id = `field-${field.name}`;
  return (
    <label htmlFor={id} className="hook-field">
      <span className="hook-field-label">
        {field.label}
        {!field.required ? " (optional)" : null}
      </span>
      <input
        id={id}
        type="number"
        required={field.required}
        value={value ?? ""}
        onChange={(e) => {
          if (e.target.value === "") {
            onChange(undefined);
            return;
          }
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : undefined);
        }}
      />
      {field.description ? (
        <small className="hook-field-desc">{field.description}</small>
      ) : null}
    </label>
  );
}
