import {
  inputDeclarations,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import {
  CopilotGenerativeUIButton,
  CopilotGenerativeUIPressable,
} from "./button";
import {
  CopilotGenerativeUICheckBox,
  CopilotGenerativeUIRadio,
  CopilotGenerativeUIRadioGroup,
  CopilotGenerativeUISegmentedControl,
} from "./choice";
import { CopilotGenerativeUIChoicePicker } from "./choice-picker";
import { CopilotGenerativeUIDateTimeInput } from "./date-time";
import { CopilotGenerativeUIForm } from "./form";
import { CopilotGenerativeUISelect } from "./select";
import { CopilotGenerativeUISlider } from "./slider";
import {
  CopilotGenerativeUITextArea,
  CopilotGenerativeUITextField,
} from "./text-field";

export {
  CopilotGenerativeUIButton,
  CopilotGenerativeUIPressable,
} from "./button";
export {
  CopilotGenerativeUICheckBox,
  CopilotGenerativeUIRadio,
  CopilotGenerativeUIRadioGroup,
  CopilotGenerativeUISegmentedControl,
} from "./choice";
export { CopilotGenerativeUIChoicePicker } from "./choice-picker";
export { CopilotGenerativeUIControl } from "./control";
export {
  CopilotGenerativeUIDateTimeInput,
  describeDateTime,
  splitDateTime,
  timeInRange,
  timeSlots,
} from "./date-time";
export { CopilotGenerativeUIForm } from "./form";
export { CopilotGenerativeUILayoutInputs } from "./layout-inputs";
export { CopilotGenerativeUISelect } from "./select";
export { CopilotGenerativeUISlider } from "./slider";
export {
  CopilotGenerativeUITextArea,
  CopilotGenerativeUITextField,
} from "./text-field";

/**
 * The standard input components: Button, Pressable, Form, and the controls.
 * Give them to `createGenerativeUI({ components: { ...inputComponents } })`.
 *
 * - Button and Pressable send `onClick`. Form sends `onSubmit`. The model
 *   binds an event to `{ "event": { "name", "userMessage"?, "context"? } }`
 *   or `{ "functionCall": { "@call", "args"? } }`, or an app function with
 *   the same name binds it automatically.
 * - The value of a control is writable: `value`. When the model binds it to
 *   `{ "@path": "/x" }`, what the user enters goes into the data model at
 *   that path, and the agent can no longer change it.
 */
export const inputComponents = withComponents(inputDeclarations, {
  Button: CopilotGenerativeUIButton,
  Pressable: CopilotGenerativeUIPressable,
  Form: CopilotGenerativeUIForm,
  TextField: CopilotGenerativeUITextField,
  TextArea: CopilotGenerativeUITextArea,
  Select: CopilotGenerativeUISelect,
  CheckBox: CopilotGenerativeUICheckBox,
  Radio: CopilotGenerativeUIRadio,
  RadioGroup: CopilotGenerativeUIRadioGroup,
  Slider: CopilotGenerativeUISlider,
  SegmentedControl: CopilotGenerativeUISegmentedControl,
  ChoicePicker: CopilotGenerativeUIChoicePicker,
  DateTimeInput: CopilotGenerativeUIDateTimeInput,
});
