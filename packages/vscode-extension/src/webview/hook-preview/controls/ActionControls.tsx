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
    <div className="hook-controls">
      <label className="hook-control-row">
        <span>Status</span>
        <select
          aria-label="Status"
          value={values.status}
          onChange={(e) =>
            onChange({ ...values, status: e.target.value as typeof values.status })
          }
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <FormRenderer
        schema={schema}
        values={values.args}
        onChange={(args) => onChange({ ...values, args })}
      />
      <label className="hook-control-row">
        <span>Result</span>
        <input
          aria-label="Result"
          type="text"
          value={values.result}
          disabled={values.status !== "complete"}
          onChange={(e) => onChange({ ...values, result: e.target.value })}
        />
      </label>
    </div>
  );
}
