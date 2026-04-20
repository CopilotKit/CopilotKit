import type { FormSchema } from "../form/schema/types";
import { FormRenderer } from "../form/FormRenderer";
import type { ActionControls as Values } from "../adapters/types";

const STATUSES = ["inProgress", "executing", "complete"] as const;

export function ActionControls({
  schema,
  values,
  onChange,
}: {
  schema: FormSchema;
  values: Values;
  onChange: (v: Values) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Status">
        <select
          aria-label="Status"
          value={values.status}
          onChange={(e) =>
            onChange({
              ...values,
              status: e.target.value as typeof values.status,
            })
          }
          className="w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white focus:border-sky-400/60 focus:outline-none focus:ring-1 focus:ring-sky-400/50"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s} className="bg-neutral-900">
              {s}
            </option>
          ))}
        </select>
      </Field>
      <FormRenderer
        schema={schema}
        values={values.args}
        onChange={(args) => onChange({ ...values, args })}
      />
      <Field label="Result">
        <input
          aria-label="Result"
          type="text"
          value={values.result}
          disabled={values.status !== "complete"}
          onChange={(e) => onChange({ ...values, result: e.target.value })}
          className="w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-sky-400/60 focus:outline-none focus:ring-1 focus:ring-sky-400/50 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </Field>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/50">
        {label}
      </span>
      {children}
    </label>
  );
}
