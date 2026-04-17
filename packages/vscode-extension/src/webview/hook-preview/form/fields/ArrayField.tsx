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
    // Seed new items with a concrete default by forcing `required: true` on
    // the item schema — without this, `defaultForField` returns undefined for
    // optional items. The schema author's own `items.required` still governs
    // the rendered field's required attribute below (we clone a separate
    // config for rendering). defaultForField is total for required fields,
    // so no ?? null fallback is needed.
    const seeded = { ...field.items, required: true } as FormField;
    onChange([...items, defaultForField(seeded)]);
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
