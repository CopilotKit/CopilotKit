import { ActionControls } from "./ActionControls";
import type { FormSchema } from "../form/schema/types";
import type { RenderToolControls as Values } from "../adapters/types";

export function RenderToolControls({
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
        <span>Tool call ID</span>
        <input
          aria-label="Tool call ID"
          type="text"
          value={values.toolCallId}
          onChange={(e) => onChange({ ...values, toolCallId: e.target.value })}
        />
      </label>
      <ActionControls
        schema={schema}
        values={values}
        onChange={(v) => onChange({ ...values, ...v })}
      />
    </div>
  );
}
