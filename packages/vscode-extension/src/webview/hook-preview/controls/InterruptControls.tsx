import { RawJsonField } from "../form/fields/RawJsonField";
import type { InterruptControls as Values } from "../adapters/types";

export function InterruptControls({
  values,
  onChange,
}: {
  values: Values;
  onChange: (v: Values) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <RawJsonField
        field={{
          kind: "raw-json",
          name: "eventValue",
          label: "Event value",
          required: true,
          hint: "Payload passed as event.value",
        }}
        value={values.eventValue}
        onChange={(eventValue) => onChange({ ...values, eventValue })}
      />
      <RawJsonField
        field={{
          kind: "raw-json",
          name: "result",
          label: "Result",
          required: false,
          hint: "Post-resolve result, if any",
        }}
        value={values.result}
        onChange={(result) => onChange({ ...values, result })}
      />
    </div>
  );
}
