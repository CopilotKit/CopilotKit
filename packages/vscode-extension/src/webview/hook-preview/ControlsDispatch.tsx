import type { RenderPropsKind } from "../../extension/hooks/hook-registry";
import type { ControlsByKind } from "./adapters/types";
import type { FormSchema } from "./form/schema/types";
import {
  ActionControls,
  CoAgentStateControls,
  InterruptControls,
  RenderToolControls,
  CustomMessageControls,
  ActivityMessageControls,
} from "./controls";

/**
 * Dispatches to the right `*Controls` component for a given render-props
 * kind. Contains the one unavoidable `as` cast boundary between the
 * dispatcher's "any of these kinds" values and each component's narrow
 * controls type. Callers pass `unknown`-typed values; the kind discriminator
 * keeps runtime correct.
 */
export function ControlsDispatch({
  kind,
  schema,
  values,
  onChange,
}: {
  kind: RenderPropsKind;
  schema: FormSchema;
  values: ControlsByKind[RenderPropsKind];
  onChange: (v: ControlsByKind[RenderPropsKind]) => void;
}) {
  // Each branch narrows `values` / `onChange` to the specific control's
  // type via a single cast. The runtime invariant (kind matches values) is
  // upheld by `controlsFor` in App.tsx.
  switch (kind) {
    case "action":
    case "human-in-the-loop":
      return (
        <ActionControls
          schema={schema}
          values={values as ControlsByKind["action"]}
          onChange={onChange as (v: ControlsByKind["action"]) => void}
        />
      );
    case "coagent-state":
      return (
        <CoAgentStateControls
          schema={schema}
          values={values as ControlsByKind["coagent-state"]}
          onChange={onChange as (v: ControlsByKind["coagent-state"]) => void}
        />
      );
    case "interrupt":
      return (
        <InterruptControls
          values={values as ControlsByKind["interrupt"]}
          onChange={onChange as (v: ControlsByKind["interrupt"]) => void}
        />
      );
    case "render-tool":
      return (
        <RenderToolControls
          schema={schema}
          values={values as ControlsByKind["render-tool"]}
          onChange={onChange as (v: ControlsByKind["render-tool"]) => void}
        />
      );
    case "custom-messages":
      return (
        <CustomMessageControls
          values={values as ControlsByKind["custom-messages"]}
          onChange={onChange as (v: ControlsByKind["custom-messages"]) => void}
        />
      );
    case "activity-message":
      return (
        <ActivityMessageControls
          values={values as ControlsByKind["activity-message"]}
          onChange={onChange as (v: ControlsByKind["activity-message"]) => void}
        />
      );
  }
}
