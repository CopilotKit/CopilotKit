import { z } from "zod";
import { def, option, writableValue } from "./shared";

const label = z.string().optional();
const opts = z.array(option);

/**
 * TextField, TextArea, Select, CheckBox, RadioGroup, Slider and Button come
 * from the Gen UI 2.0 standard catalog; these are the inputs it does not have.
 *
 * Every input's `value` is writable: bind it to a data-model path
 * (`{ "@path": "/form/email" }`) and the renderer writes edits back through
 * `setValue`. A Button's event context reads those paths at click time.
 */
export const inputDefinitions = {
  Combobox: def(
    "Inputs",
    "Searchable dropdown for long option lists (countries, cities, timezones).",
    z.object({
      label,
      value: z.string().optional(),
      options: opts,
      placeholder: z.string().optional(),
    }),
    writableValue,
  ),
  Switch: def(
    "Inputs",
    "On/off toggle with label and description.",
    z.object({
      label: z.string(),
      value: z.boolean().optional(),
      description: z.string().optional(),
    }),
    writableValue,
  ),
  DatePicker: def(
    "Inputs",
    "Date picker with calendar popover; value ISO date bound to a path.",
    z.object({
      label,
      value: z.string().optional(),
      placeholder: z.string().optional(),
    }),
    writableValue,
  ),
  ButtonGroup: def(
    "Inputs",
    "Segmented single-choice control; value bound to a path.",
    z.object({ label, value: z.string().optional(), options: opts }),
    writableValue,
  ),
  ChipSelect: def(
    "Inputs",
    "Multi-select chips bound to a string-list path: extras, interests, dietary needs.",
    z.object({ label, value: z.array(z.string()).optional(), options: opts }),
    writableValue,
  ),
};
