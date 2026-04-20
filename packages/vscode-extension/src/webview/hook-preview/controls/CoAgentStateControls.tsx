import type { FormSchema } from "../form/schema/types";
import { FormRenderer } from "../form/FormRenderer";
import { RawJsonField } from "../form/fields/RawJsonField";
import type { CoAgentStateControls as Values } from "../adapters/types";

const STATUSES = ["inProgress", "executing", "complete"] as const;

export function CoAgentStateControls({
  schema,
  values,
  onChange,
}: {
  schema: FormSchema;
  values: Values;
  onChange: (v: Values) => void;
}) {
  const hasFormSchema =
    schema.fields.length > 0 &&
    schema.fields.some((f) => f.kind !== "raw-json");

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/50">
          Status
        </span>
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
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/50">
          Node name
        </span>
        <input
          aria-label="Node name"
          type="text"
          value={values.nodeName}
          onChange={(e) => onChange({ ...values, nodeName: e.target.value })}
          className="w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-sky-400/60 focus:outline-none focus:ring-1 focus:ring-sky-400/50"
        />
      </label>
      {hasFormSchema ? (
        <FormRenderer
          schema={schema}
          values={values.state}
          onChange={(state) =>
            onChange({ ...values, state: state as Record<string, unknown> })
          }
        />
      ) : (
        <RawJsonField
          field={{
            kind: "raw-json",
            name: "state",
            label: "state",
            required: true,
            hint: "Agent state has no runtime schema; edit as JSON.",
          }}
          value={values.state}
          onChange={(state) =>
            onChange({ ...values, state: state as Record<string, unknown> })
          }
        />
      )}
    </div>
  );
}
