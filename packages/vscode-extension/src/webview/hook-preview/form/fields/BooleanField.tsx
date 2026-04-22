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
    <label
      htmlFor={id}
      className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
    >
      <input
        id={id}
        type="checkbox"
        required={field.required}
        checked={value ?? false}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer rounded border-white/20 bg-black/40 accent-sky-400"
      />
      <span className="text-sm text-white/90">
        {field.label}
        {!field.required ? (
          <span className="ml-1 text-xs text-white/40">(optional)</span>
        ) : null}
      </span>
      {field.description ? (
        <small className="ml-auto text-xs text-white/40">
          {field.description}
        </small>
      ) : null}
    </label>
  );
}
