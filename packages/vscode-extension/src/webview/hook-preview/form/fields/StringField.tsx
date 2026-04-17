import type { FormField } from "../schema/types";

export function StringField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { kind: "string" }>;
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const id = `field-${field.name}`;
  return (
    <label htmlFor={id} className="hook-field">
      <span className="hook-field-label">{field.label}{!field.required ? " (optional)" : ""}</span>
      {field.enum ? (
        <select id={id} aria-label={field.label} value={value ?? field.enum[0]} onChange={(e) => onChange(e.target.value)}>
          {field.enum.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type="text"
          aria-label={field.label}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.description ? <small className="hook-field-desc">{field.description}</small> : null}
    </label>
  );
}
