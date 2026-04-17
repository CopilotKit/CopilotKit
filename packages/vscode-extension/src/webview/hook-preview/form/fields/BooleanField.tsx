import type { FormField } from "../schema/types";

export function BooleanField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { kind: "boolean" }>;
  value: boolean | undefined;
  onChange: (v: boolean) => void;
}) {
  const id = `field-${field.name}`;
  return (
    <label htmlFor={id} className="hook-field hook-field-boolean">
      <input
        id={id}
        type="checkbox"
        required={field.required}
        checked={value ?? false}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="hook-field-label">
        {field.label}
        {!field.required ? " (optional)" : null}
      </span>
      {field.description ? <small className="hook-field-desc">{field.description}</small> : null}
    </label>
  );
}
