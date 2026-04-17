import type { FormSchema } from "./schema/types";
import { FieldRenderer } from "./FieldRenderer";

export function FormRenderer({
  schema,
  values,
  onChange,
}: {
  schema: FormSchema;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  return (
    <div className="hook-form">
      {schema.fields.map((field) => (
        <FieldRenderer
          key={field.name}
          field={field}
          value={values[field.name]}
          onChange={(v) => onChange({ ...values, [field.name]: v })}
        />
      ))}
    </div>
  );
}
