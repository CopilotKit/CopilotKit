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
          onChange={(v) => {
            // `undefined` means the field has no value (e.g., optional field
            // cleared). Drop the key entirely so `render` callbacks that read
            // args see a missing property, matching the runtime contract.
            const next = { ...values };
            if (v === undefined) {
              delete next[field.name];
            } else {
              next[field.name] = v;
            }
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}
