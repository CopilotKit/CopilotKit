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
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/50">
          Tool call ID
        </span>
        <input
          aria-label="Tool call ID"
          type="text"
          value={values.toolCallId}
          onChange={(e) => onChange({ ...values, toolCallId: e.target.value })}
          className="w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-sky-400/60 focus:outline-none focus:ring-1 focus:ring-sky-400/50"
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
