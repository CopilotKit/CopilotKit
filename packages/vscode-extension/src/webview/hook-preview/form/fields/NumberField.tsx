import type { FormField } from "../schema/types";

export function NumberField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { kind: "number" }>;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  const id = `field-${field.name}`;
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/50">
        {field.label}
        {!field.required ? (
          <span className="ml-1 normal-case text-white/30">(optional)</span>
        ) : null}
      </span>
      <input
        id={id}
        type="number"
        required={field.required}
        value={value ?? ""}
        onChange={(e) => {
          if (e.target.value === "") {
            onChange(undefined);
            return;
          }
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : undefined);
        }}
        className="w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-sky-400/60 focus:outline-none focus:ring-1 focus:ring-sky-400/50"
      />
      {field.description ? (
        <small className="text-xs text-white/40">{field.description}</small>
      ) : null}
    </label>
  );
}
