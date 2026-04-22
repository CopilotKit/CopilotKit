import type { FormField } from "../schema/types";

const INPUT_CLS =
  "w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-sky-400/60 focus:outline-none focus:ring-1 focus:ring-sky-400/50";

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
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/50">
        {field.label}
        {!field.required ? (
          <span className="ml-1 normal-case text-white/30">(optional)</span>
        ) : null}
      </span>
      {field.enum ? (
        <select
          id={id}
          required={field.required}
          value={value ?? field.enum[0]}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT_CLS}
        >
          {field.enum.map((v) => (
            <option key={v} value={v} className="bg-neutral-900">
              {v}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type="text"
          required={field.required}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT_CLS}
        />
      )}
      {field.description ? (
        <small className="text-xs text-white/40">{field.description}</small>
      ) : null}
    </label>
  );
}
