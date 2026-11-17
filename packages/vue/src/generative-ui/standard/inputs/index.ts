import {
  inputDeclarations,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import CopilotGenerativeUIButton from "./Button.vue";
import CopilotGenerativeUICheckBox from "./CheckBox.vue";
import CopilotGenerativeUIChoicePicker from "./ChoicePicker.vue";
import CopilotGenerativeUIDateTimeInput from "./DateTimeInput.vue";
import CopilotGenerativeUIForm from "./Form.vue";
import CopilotGenerativeUIPressable from "./Pressable.vue";
import CopilotGenerativeUIRadio from "./Radio.vue";
import CopilotGenerativeUIRadioGroup from "./RadioGroup.vue";
import CopilotGenerativeUISegmentedControl from "./SegmentedControl.vue";
import CopilotGenerativeUISelect from "./Select.vue";
import CopilotGenerativeUISlider from "./Slider.vue";
import CopilotGenerativeUITextArea from "./TextArea.vue";
import CopilotGenerativeUITextField from "./TextField.vue";

export {
  CopilotGenerativeUIButton,
  CopilotGenerativeUICheckBox,
  CopilotGenerativeUIChoicePicker,
  CopilotGenerativeUIDateTimeInput,
  CopilotGenerativeUIForm,
  CopilotGenerativeUIPressable,
  CopilotGenerativeUIRadio,
  CopilotGenerativeUIRadioGroup,
  CopilotGenerativeUISegmentedControl,
  CopilotGenerativeUISelect,
  CopilotGenerativeUISlider,
  CopilotGenerativeUITextArea,
  CopilotGenerativeUITextField,
};
export {
  describeDateTime,
  splitDateTime,
  timeInRange,
  timeSlots,
} from "./date-time";

/**
 * The standard input components: Button, Pressable, Form, and the controls.
 * Give them to `createGenerativeUI({ components: { ...inputComponents } })`.
 *
 * - Button and Pressable send `onClick`. Form sends `onSubmit`. The model
 *   binds an event to `{ "event": { "name", "userMessage"?, "context"? } }`
 *   or `{ "functionCall": { "@call", "args"? } }`, or an app function with
 *   the same name binds it automatically.
 * - The value of a control is writable: `value`, with an `update:value`
 *   emit. When the model binds it to `{ "@path": "/x" }`, what the user
 *   enters goes into the data model at that path, and the agent can no
 *   longer change it.
 *
 * @example
 * ```ts
 * const ui = createGenerativeUI({ components: { ...inputComponents } });
 * ```
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
