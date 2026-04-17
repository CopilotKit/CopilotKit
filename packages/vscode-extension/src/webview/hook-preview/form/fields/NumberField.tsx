import type { FormField } from "../schema/types";

export function NumberField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { kind: "number" }>;
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  const id = `field-${field.name}`;
  return (
    <label htmlFor={id} className="hook-field">
      <span className="hook-field-label">{field.label}{!field.required ? " (optional)" : ""}</span>
      <input
        id={id}
        type="number"
        aria-label={field.label}
        value={value ?? ""}
        onChange={(e) => {
          const n = e.target.value === "" ? 0 : Number(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
      />
      {field.description ? <small className="hook-field-desc">{field.description}</small> : null}
    </label>
  );
}
