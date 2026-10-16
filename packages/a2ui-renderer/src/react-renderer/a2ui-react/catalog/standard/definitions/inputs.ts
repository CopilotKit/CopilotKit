import { z } from "zod";
import {
  ActionSchema,
  DynamicBooleanSchema,
  DynamicNumberSchema,
  DynamicStringSchema,
} from "@a2ui/web_core/v0_9";
import type { CatalogDefinitions } from "../../../../create-catalog";
import { bindable, childIds, layoutProps } from "./layout";

/**
 * Same action schema as the basic `Button`: `{ event: { name, context? } }`
 * (or a local `functionCall`). The binder turns it into a `() => void`.
 */
const action = ActionSchema.optional().describe(
  'Dispatched on click/submit. { "event": { "name": "...", "context": { ... } } }',
);

/** Choice list: plain strings or `{ value, label, description? }`. */
export const optionList = z
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

export type OptionList = z.infer<typeof optionList>;

/** `optionList` that also accepts a `{ "path": "/x" }` data binding. */
const bindableOptionList = bindable(optionList.unwrap())
  .optional()
  .describe(
    'Strings or { "value", "label", "description"? }, or { "path": "/x" }',
  );

const SIZES = ["sm", "md", "lg", "xl"] as const;
const size = (def: string) =>
  z.enum(SIZES).optional().describe(`Default "${def}"`);
const pill = z.boolean().optional().describe("Default true");
const boundString = (d: string) => DynamicStringSchema.optional().describe(d);
const boundNumber = (d: string) => DynamicNumberSchema.optional().describe(d);

export const inputDefinitions = {
  Button: {
    description:
      'Clickable button that dispatches `action`; without an action it does nothing. One primary Button per Row, the rest variant "ghost". `children` ids render instead of `label` when present.',
    props: z.object({
      label: boundString("Button text"),
      text: boundString("Alias of `label`; used when `label` is absent"),
      children: childIds,
      action,
      variant: z
        .enum(["solid", "soft", "outline", "ghost"])
        .optional()
        .describe('Default "solid"'),
      color: z
        .enum(["primary", "secondary", "danger"])
        .optional()
        .describe('Default "primary"'),
      size: z.enum(["sm", "md", "lg"]).optional().describe('Default "lg"'),
      block: z.boolean().optional(),
      pill,
      disabled: DynamicBooleanSchema.optional(),
      loading: z.boolean().optional(),
      submit: z
        .boolean()
        .optional()
        .describe("type=submit (submits the enclosing Form)"),
      icon: z.string().optional().describe("Lucide icon name"),
      uniform: z.boolean().optional(),
      href: boundString(
        "Opens this URL in a new tab on click instead of dispatching action",
      ),
      copy: boundString(
        "Copies this text to the clipboard on click (shows a check mark) instead of dispatching action",
      ),
    }),
  },
  Pressable: {
    description:
      "Clickable layout container that dispatches `action` (or opens `href`).",
    props: z.object({
      ...layoutProps,
      action,
      href: boundString("Opens this URL in a new tab on click"),
      disabled: DynamicBooleanSchema.optional(),
      hoverBackground: z.string().optional(),
    }),
  },
  Form: {
    description:
      "Layout container rendered as a <form>; `action` is dispatched on submit.",
    props: z.object({ ...layoutProps, action }),
  },
  TextField: {
    description: "Single-line text input bound to `value`.",
    props: z.object({
      value: boundString('Bind with { "path": "/x" }'),
      placeholder: boundString("Placeholder text"),
      label: boundString("Field label"),
      inputType: z
        .enum(["text", "number", "email", "password", "url", "tel"])
        .optional()
        .describe('Default "text"'),
      name: z.string().optional(),
      required: z.boolean().optional(),
      disabled: z.boolean().optional(),
      invalid: z.boolean().optional(),
      size: size("xl"),
      pill,
      autoSelect: z.boolean().optional(),
      mask: z.string().optional(),
    }),
  },
  TextArea: {
    description: "Multi-line text input bound to `value`.",
    props: z.object({
      value: boundString('Bind with { "path": "/x" }'),
      placeholder: boundString("Placeholder text"),
      label: boundString("Field label"),
      rows: z.number().optional(),
      maxRows: z.number().optional(),
      autoResize: z.boolean().optional(),
      name: z.string().optional(),
      required: z.boolean().optional(),
      disabled: z.boolean().optional(),
      invalid: z.boolean().optional(),
      size: size("xl"),
    }),
  },
  Select: {
    description: "Dropdown bound to `value`.",
    props: z.object({
      value: boundString('Bind with { "path": "/x" }'),
      options: bindableOptionList,
      placeholder: boundString("Placeholder text"),
      label: boundString("Field label"),
      name: z.string().optional(),
      required: z.boolean().optional(),
      disabled: z.boolean().optional(),
      clearable: z.boolean().optional(),
      searchable: z.boolean().optional(),
      size: size("xl"),
      pill,
    }),
  },
  CheckBox: {
    description: "Checkbox bound to `checked`.",
    props: z.object({
      checked: DynamicBooleanSchema.optional().describe(
        "Bound boolean state of the box; bind this to a data path (not `value`)",
      ),
      label: boundString("Label text"),
      name: z.string().optional(),
      value: z.string().optional().describe('Default "on"'),
      disabled: z.boolean().optional(),
      required: z.boolean().optional(),
      lineThrough: z
        .boolean()
        .optional()
        .describe("Default false; strike the label when checked"),
      shape: z.enum(["round", "square"]).optional().describe('Default "round"'),
    }),
  },
  Radio: {
    description: "Single radio button (prefer RadioGroup).",
    props: z.object({
      value: z.string().optional(),
      label: z.string().optional(),
      disabled: z.boolean().optional(),
      required: z.boolean().optional(),
    }),
  },
  RadioGroup: {
    description: "Group of radio buttons bound to `value`.",
    props: z.object({
      value: boundString('Bind with { "path": "/x" }'),
      options: bindableOptionList,
      label: boundString("Field label"),
      name: z.string().optional(),
      direction: z.enum(["row", "col"]).optional().describe('Default "row"'),
      variant: z.enum(["list", "pills", "cards"]).optional(),
      disabled: z.boolean().optional(),
      required: z.boolean().optional(),
    }),
  },
  Slider: {
    description: "Range slider bound to `value` (number).",
    props: z.object({
      value: DynamicNumberSchema.optional().describe(
        'Bind with { "path": "/x" }',
      ),
      min: boundNumber("Default 0"),
      max: boundNumber("Default 100"),
      step: boundNumber("Default 1"),
      label: boundString("Slider label"),
      unit: boundString('Unit suffix, e.g. "%"'),
      marks: bindable(
        z.array(z.object({ value: z.number(), label: z.string().optional() })),
      ).optional(),
      sliderStyle: z
        .enum(["continuous", "discrete"])
        .optional()
        .describe('Default "continuous"'),
      disabled: z.boolean().optional(),
      name: z.string().optional(),
    }),
  },
  SegmentedControl: {
    description: "Segmented button group bound to `value`.",
    props: z.object({
      value: boundString('Bind with { "path": "/x" }'),
      options: bindableOptionList,
      label: boundString("Field label"),
      block: z.boolean().optional(),
      size: size("lg"),
      pill,
      variant: z
        .enum(["solid", "soft", "outline", "ghost"])
        .optional()
        .describe('Default "ghost"'),
      disabled: z.boolean().optional(),
    }),
  },
  DateTimeInput: {
    description: 'Date picker bound to `value` ("YYYY-MM-DD").',
    props: z.object({
      value: boundString('"YYYY-MM-DD". Bind with { "path": "/x" }'),
      label: boundString("Field label"),
      min: boundString('Earliest date, "YYYY-MM-DD"'),
      max: boundString('Latest date, "YYYY-MM-DD"'),
      placeholder: boundString("Placeholder text"),
      disabled: z.boolean().optional(),
      required: z.boolean().optional(),
      clearable: z.boolean().optional(),
    }),
  },
} satisfies CatalogDefinitions;
