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
      <label className="hook-control-row">
        <span>Node name</span>
        <input
          aria-label="Node name"
          type="text"
          value={values.nodeName}
          onChange={(e) => onChange({ ...values, nodeName: e.target.value })}
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
