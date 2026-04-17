import { ActionControls } from "./ActionControls";
import type { FormSchema } from "../form/schema/types";
import type {
  ActionControls as ActionValues,
  RenderToolControls as Values,
} from "../adapters/types";

export function RenderToolControls({
  schema,
  values,
  onChange,
}: {
  schema: FormSchema;
  values: Values;
  onChange: (v: Values) => void;
}) {
  // Narrow the props we hand to ActionControls so toolCallId doesn't leak in
  // or out via the nested onChange. The nested control owns only the
  // action-shaped fields; we recombine toolCallId on every change.
  const actionValues: ActionValues = {
    args: values.args,
    status: values.status,
    result: values.result,
    onRespond: values.onRespond,
  };
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
        values={actionValues}
        onChange={(v) => onChange({ ...v, toolCallId: values.toolCallId })}
      />
    </div>
  );
}
