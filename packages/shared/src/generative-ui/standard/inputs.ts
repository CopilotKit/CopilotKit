import { z } from "zod";
import { checksProp } from "./checks";
import {
  CHILDREN_SLOT,
  NO_ARGS,
  VISIBLE_EVENT,
  layoutProps,
  weightProp,
} from "./layout";

// ---- Shared schemas ----

/** A list of choices: plain strings or `{ value, label, description? }`. */
const optionList = z
  .array(
    z.union([
      z.string(),
      z.object({
        value: z.string(),
        label: z.string().optional(),
        description: z.string().optional(),
      }),
    ]),
  )
  .optional()
  .describe('Strings or { "value", "label", "description"? }');

export type InputOptionList = z.output<typeof optionList>;

export const INPUT_SIZES = ["sm", "md", "lg", "xl"] as const;
export type InputSize = (typeof INPUT_SIZES)[number];

const size = (fallback: InputSize) =>
  z.enum(INPUT_SIZES).optional().describe(`Default "${fallback}"`);
const pill = z.boolean().optional().describe("Default true");
const fieldLabel = z
  .string()
  .optional()
  .describe("The visible label of the field. Always set it");
const boundValue = z
  .string()
  .optional()
  .describe('Bind it with { "@path": "/x" } to read what the user entered');

export const buttonSchema = z.object({
  label: z.string().optional().describe("The button text"),
  checks: checksProp,
  text: z
    .string()
    .optional()
    .describe("Same as label. Used when label is not set"),
  variant: z
    .enum(["default", "primary", "soft", "borderless"])
    .optional()
    .describe(
      'Default "default": outlined. "primary" is filled, for the one main action. "borderless" has no box, like a link',
    ),
  color: z
    .enum(["primary", "secondary", "danger"])
    .optional()
    .describe('Default "primary"'),
  size: z.enum(["sm", "md", "lg"]).optional().describe('Default "lg"'),
  block: z.boolean().optional().describe("Full width"),
  weight: weightProp,
  pill,
  disabled: z.boolean().optional(),
  loading: z.boolean().optional(),
  submit: z
    .boolean()
    .optional()
    .describe("Submits the Form around it. The Form sends its onSubmit event"),
  icon: z.string().optional().describe("Lucide icon name"),
  uniform: z.boolean().optional().describe("A square button, for an icon"),
  href: z
    .string()
    .optional()
    .describe("Opens this URL in a new tab on click, instead of onClick"),
  copy: z
    .string()
    .optional()
    .describe(
      "Copies this text to the clipboard on click and shows a check mark, instead of onClick",
    ),
});
export const pressableSchema = z.object({
  ...layoutProps,
  disabled: z.boolean().optional(),
  hoverBackground: z.string().optional(),
  href: z
    .string()
    .optional()
    .describe("Opens this URL in a new tab on click, instead of onClick"),
  tooltip: z.string().optional().describe("Shown on hover"),
  ariaPressed: z.boolean().optional().describe("For a toggle"),
  insetBorder: z.boolean().optional().describe("A 1px border inside the box"),
});
export const formSchema = z.object({
  ...layoutProps,
  label: z
    .string()
    .optional()
    .describe("A short name of the form for screen readers"),
});
export const textFieldSchema = z.object({
  checks: checksProp,
  value: z
    .union([z.string(), z.number()])
    .optional()
    .describe('Bind it with { "@path": "/x" } to read what the user typed'),
  placeholder: z.string().optional(),
  label: fieldLabel,
  variant: z
    .enum([
      "shortText",
      "longText",
      "number",
      "obscured",
      "email",
      "url",
      "tel",
    ])
    .optional()
    .describe(
      'Default "shortText". "longText" is a multi-line field, "obscured" a password',
    ),
  weight: weightProp,
  name: z.string().optional(),
  required: z.boolean().optional(),
  disabled: z.boolean().optional(),
  invalid: z.boolean().optional(),
  size: size("xl"),
  pill,
  autoSelect: z.boolean().optional(),
  mask: z.string().optional(),
});
export const textAreaSchema = z.object({
  checks: checksProp,
  value: boundValue,
  placeholder: z.string().optional(),
  label: fieldLabel,
  weight: weightProp,
  rows: z.number().optional().describe("Default 3"),
  maxRows: z.number().optional(),
  autoResize: z.boolean().optional(),
  name: z.string().optional(),
  required: z.boolean().optional(),
  disabled: z.boolean().optional(),
  invalid: z.boolean().optional(),
  size: size("xl"),
});
export const selectSchema = z.object({
  checks: checksProp,
  value: boundValue,
  options: optionList,
  placeholder: z.string().optional(),
  label: fieldLabel,
  name: z.string().optional(),
  required: z.boolean().optional(),
  disabled: z.boolean().optional(),
  clearable: z.boolean().optional(),
  clearLabel: z.string().optional().describe("The label of the empty option"),
  searchable: z.boolean().optional(),
  icon: z.string().optional().describe("Lucide icon shown before the value"),
  block: z.boolean().optional().describe("Full width"),
  size: size("xl"),
  pill,
});
export const checkBoxSchema = z.object({
  checks: checksProp,
  value: z
    .boolean()
    .optional()
    .describe(
      'True when checked. Bind it with { "@path": "/x" } to read the state of the box',
    ),
  label: z.string().optional().describe("The label text. Always set it"),
  name: z.string().optional(),
  weight: weightProp,
  disabled: z.boolean().optional(),
  required: z.boolean().optional(),
  lineThrough: z
    .boolean()
    .optional()
    .describe("Default false. Strikes the label when the box is checked"),
  shape: z.enum(["round", "square"]).optional().describe('Default "round"'),
});
export const radioSchema = z.object({
  value: z.string().optional(),
  label: z.string().optional(),
  disabled: z.boolean().optional(),
  required: z.boolean().optional(),
});
export const radioGroupSchema = z.object({
  checks: checksProp,
  value: boundValue,
  options: optionList,
  label: fieldLabel,
  name: z.string().optional(),
  direction: z.enum(["row", "col"]).optional().describe('Default "row"'),
  variant: z.enum(["list", "pills", "cards"]).optional(),
  disabled: z.boolean().optional(),
  required: z.boolean().optional(),
});
export const sliderSchema = z.object({
  checks: checksProp,
  value: z
    .number()
    .optional()
    .describe('Bind it with { "@path": "/x" } to read the number'),
  min: z.number().optional().describe("Default 0"),
  max: z.number().optional().describe("Default 100"),
  step: z.number().optional().describe("Default 1"),
  steps: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "The number of equal divisions between min and max, instead of step",
    ),
  label: fieldLabel,
  weight: weightProp,
  unit: z.string().optional().describe('Unit after the value, for example "%"'),
  marks: z
    .array(z.object({ value: z.number(), label: z.string().optional() }))
    .optional(),
  sliderStyle: z
    .enum(["continuous", "discrete"])
    .optional()
    .describe('Default "continuous"'),
  disabled: z.boolean().optional(),
  name: z.string().optional(),
});
export const segmentedControlSchema = z.object({
  checks: checksProp,
  value: boundValue,
  options: optionList,
  label: fieldLabel,
  block: z.boolean().optional().describe("Full width"),
  size: size("lg"),
  pill,
  variant: z
    .enum(["solid", "soft", "outline", "ghost"])
    .optional()
    .describe('Default "ghost"'),
  disabled: z.boolean().optional(),
});
export const choicePickerSchema = z.object({
  checks: checksProp,
  value: z
    .array(z.string())
    .optional()
    .describe(
      'The chosen option values. Bind it with { "@path": "/x" } to a string list',
    ),
  options: optionList,
  label: fieldLabel,
  variant: z
    .enum(["multipleSelection", "mutuallyExclusive"])
    .optional()
    .describe('Default "mutuallyExclusive": the user picks one option'),
  displayStyle: z
    .enum(["checkbox", "chips"])
    .optional()
    .describe('Default "checkbox". "chips" shows the options as pills'),
  filterable: z
    .boolean()
    .optional()
    .describe("Default false. Shows a field that filters the options"),
  weight: weightProp,
  disabled: z.boolean().optional(),
  required: z.boolean().optional(),
});
export const dateTimeInputSchema = z.object({
  checks: checksProp,
  value: z
    .string()
    .optional()
    .describe(
      'ISO 8601: "YYYY-MM-DD", "HH:MM" or "YYYY-MM-DDTHH:MM". Bind it with { "@path": "/x" }',
    ),
  label: fieldLabel,
  enableDate: z
    .boolean()
    .optional()
    .describe(
      "The user picks a date. Default true unless only enableTime is set",
    ),
  enableTime: z.boolean().optional().describe("The user picks a time"),
  timeStep: z
    .number()
    .int()
    .min(1)
    .max(720)
    .optional()
    .describe(
      "Minutes between the times the user can pick, e.g. 15 or 30. Shows the time as a list",
    ),
  weight: weightProp,
  min: z.string().optional().describe("The earliest value, ISO 8601"),
  max: z.string().optional().describe("The latest value, ISO 8601"),
  placeholder: z.string().optional(),
  disabled: z.boolean().optional(),
  required: z.boolean().optional(),
  clearable: z.boolean().optional(),
  block: z.boolean().optional().describe("Full width"),
});

/** The writable list of a control that keeps its state in `value`. */
const VALUE_WRITABLE = ["value"] as const;

// ---- Catalog ----

/**
 * The declarations of the standard input components: Button, Pressable,
 * Form, and the controls. A framework adds its components with
 * `withComponents`.
 *
 * - Button and Pressable send `onClick`. Form sends `onSubmit`. The model
 *   binds an event to `{ "event": { "name", "userMessage"?, "context"? } }`
 *   or `{ "functionCall": { "@call", "args"? } }`, or an app function with
 *   the same name binds it automatically.
 * - The value of a control is writable: `value`.
 *   When the model binds it to `{ "@path": "/x" }`, what the user enters goes
 *   into the data model at that path, and the agent can no longer change it.
 */
export const inputDeclarations = {
  Button: {
    description:
      'A button that sends its onClick event. With href it opens the URL, and with copy it copies the text, both without the agent. Use variant "primary" for the one main Button in a Row, and the default for the others. With submit true inside a Form, it submits the Form. The child or children render instead of the label. With checks, it is disabled while a check fails.',
    props: buttonSchema,
    events: {
      onClick: {
        description: "Sent when the user clicks the button.",
        parameters: NO_ARGS,
      },
    },
    slots: { child: "single", children: "multiple" } as const,
  },
  Pressable: {
    description:
      "A layout container that the user can click or press with Enter or Space. It sends its onClick event, or opens href. A control inside it sends only its own event.",
    props: pressableSchema,
    events: {
      ...VISIBLE_EVENT,
      onClick: {
        description: "Sent when the user clicks or presses the container.",
        parameters: NO_ARGS,
      },
    },
    slots: CHILDREN_SLOT,
  },
  Form: {
    description:
      'A layout container that is a form. It sends its onSubmit event when the user submits it (a Button with submit true, or Enter in a field). Put the values of its fields in the event context with { "@path": "/x" }.',
    props: formSchema,
    events: {
      onSubmit: {
        description: "Sent when the user submits the form.",
        parameters: NO_ARGS,
      },
    },
    slots: CHILDREN_SLOT,
  },
  TextField: {
    description:
      'A text input, single-line unless variant is "longText". Bind value with { "@path": "/x" } to read what the user typed. Give it a label.',
    props: textFieldSchema,
    writable: VALUE_WRITABLE,
  },
  TextArea: {
    description:
      'A multi-line text input. Bind value with { "@path": "/x" } to read what the user typed. Give it a label.',
    props: textAreaSchema,
    writable: VALUE_WRITABLE,
  },
  Select: {
    description:
      'A dropdown list of options. Bind value with { "@path": "/x" } to read the chosen option. Give it a label.',
    props: selectSchema,
    writable: VALUE_WRITABLE,
  },
  CheckBox: {
    description:
      'A checkbox with a label. Bind value with { "@path": "/x" } to read its state, true or false.',
    props: checkBoxSchema,
    writable: VALUE_WRITABLE,
  },
  Radio: {
    description:
      "One radio button. Use RadioGroup instead, because it keeps the chosen value.",
    props: radioSchema,
  },
  RadioGroup: {
    description:
      'A group of radio buttons. The user chooses one option. Bind value with { "@path": "/x" } to read it. Give it a label.',
    props: radioGroupSchema,
    writable: VALUE_WRITABLE,
  },
  Slider: {
    description:
      'A range slider for a number between min and max. Bind value with { "@path": "/x" } to read the number. Give it a label.',
    props: sliderSchema,
    writable: VALUE_WRITABLE,
  },
  SegmentedControl: {
    description:
      'A row of segments. The user chooses one option. Use it for 2 to 5 short options. Bind value with { "@path": "/x" } to read it.',
    props: segmentedControlSchema,
    writable: VALUE_WRITABLE,
  },
  ChoicePicker: {
    description:
      'A list of options, as checkboxes or chips. The user picks one, or several with variant "multipleSelection". Bind value with { "@path": "/x" } to read the chosen values as a list. Give it a label.',
    props: choicePickerSchema,
    writable: VALUE_WRITABLE,
  },
  DateTimeInput: {
    description:
      'A date picker, or a time picker with enableTime, or both. Set timeStep (minutes) to offer fixed times, e.g. 30 for a booking. The value is ISO 8601. Bind value with { "@path": "/x" } to read it. Give it a label.',
    props: dateTimeInputSchema,
    writable: VALUE_WRITABLE,
  },
};
