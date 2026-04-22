import type { FormField } from "../schema/types";
import { FieldRenderer } from "../FieldRenderer";

export function ObjectField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { kind: "object" }>;
  value: Record<string, unknown> | undefined;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const current = value ?? {};
  return (
    <fieldset className="hook-field hook-field-object">
      <legend>
        {field.label}
        {!field.required ? " (optional)" : null}
      </legend>
      {field.fields.map((child) => (
        <FieldRenderer
          key={child.name}
          field={child}
          value={current[child.name]}
          onChange={(v) => onChange({ ...current, [child.name]: v })}
        />
      ))}
      {field.description ? (
        <small className="hook-field-desc">{field.description}</small>
      ) : null}
    </fieldset>
  );
}
