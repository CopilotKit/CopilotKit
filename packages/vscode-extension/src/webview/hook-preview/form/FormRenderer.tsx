import type { FormSchema } from "./schema/types";
import { FieldRenderer } from "./FieldRenderer";

export function FormRenderer({
  schema,
  values,
  onChange,
}: {
  schema: FormSchema;
  // Upstream seeding (`mergeValues` in App.tsx's `controlsFor`) should
  // produce an object, but a cleared/unset captured config leaves this
  // undefined on the first render tick. Defaulting avoids crashing the
  // whole webview on `values[field.name]`.
  values: Record<string, unknown> | undefined;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const safeValues = values ?? {};
  // Upstream schema builders should never produce `undefined` entries, but
  // an ill-formed captured config can still sneak one in (e.g. a user that
  // passes `parameters: [undefined]`). Filter before render so one bad row
  // doesn't crash the whole preview.
  const fields = schema.fields.filter((f): f is NonNullable<typeof f> => !!f);
  if (fields.length === 0) {
    return (
      <p className="m-0 rounded-md border border-dashed border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-white/40">
        No parameters declared.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 border-t border-dashed border-white/10 pt-3">
      {fields.map((field) => (
        <FieldRenderer
          key={field.name}
          field={field}
          value={safeValues[field.name]}
          onChange={(v) => {
            // `undefined` means the field has no value (e.g., optional field
            // cleared). Drop the key entirely so `render` callbacks that read
            // args see a missing property, matching the runtime contract.
            const next = { ...safeValues };
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
