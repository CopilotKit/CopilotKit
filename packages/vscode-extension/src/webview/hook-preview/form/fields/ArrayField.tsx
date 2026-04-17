import type { FormField } from "../schema/types";
import { defaultForField } from "../schema/normalize";
import { FieldRenderer } from "../FieldRenderer";

export function ArrayField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { kind: "array" }>;
  value: unknown[] | undefined;
  onChange: (v: unknown[]) => void;
}) {
  const items = value ?? [];
  const update = (i: number, v: unknown) =>
    onChange(items.map((item, idx) => (idx === i ? v : item)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => {
    const filled = { ...field.items, required: true } as FormField;
    const def = defaultForField(filled);
    onChange([...items, def ?? null]);
  };

  return (
    <fieldset className="hook-field hook-field-array">
      <legend>
        {field.label}
        {!field.required ? " (optional)" : null}
      </legend>
      {items.map((item, i) => (
        <div key={i} className="hook-field-array-item">
          <FieldRenderer
            field={{
              ...field.items,
              name: `${field.name}[${i}]`,
              label: `#${i}`,
            }}
            value={item}
            onChange={(v) => update(i, v)}
          />
          <button type="button" onClick={() => remove(i)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={add}>
        Add
      </button>
      {field.description ? (
        <small className="hook-field-desc">{field.description}</small>
      ) : null}
    </fieldset>
  );
}
