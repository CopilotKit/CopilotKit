import type { Type } from "@angular/core";
import type { ComponentApi } from "@a2ui/web_core/v0_9";
import {
  AudioPlayerApi,
  BASIC_FUNCTIONS,
  ButtonApi,
  CardApi,
  CheckBoxApi,
  ChoicePickerApi,
  ColumnApi,
  DateTimeInputApi,
  DividerApi,
  IconApi,
  ImageApi,
  ListApi,
  ModalApi,
  RowApi,
  SliderApi,
  TabsApi,
  TextApi,
  TextFieldApi,
  VideoApi,
} from "@a2ui/web_core/v0_9/basic_catalog";
import { CopilotA2UICatalog } from "../catalog";
import type { CopilotA2UIComponentImplementation } from "../types";
import { CopilotA2UIAudioPlayer } from "./audio-player";
import { CopilotA2UIButton } from "./button";
import { CopilotA2UICard } from "./card";
import { CopilotA2UICheckBox } from "./check-box";
import { CopilotA2UIChoicePicker } from "./choice-picker";
import { CopilotA2UIColumn } from "./column";
import { CopilotA2UIDateTimeInput } from "./date-time-input";
import { CopilotA2UIDivider } from "./divider";
import { CopilotA2UIIcon } from "./icon";
import { CopilotA2UIImage } from "./image";
import { CopilotA2UIList } from "./list";
import { CopilotA2UIModal } from "./modal";
import { CopilotA2UIRow } from "./row";
import { CopilotA2UISlider } from "./slider";
import { CopilotA2UITabs } from "./tabs";
import { CopilotA2UIText } from "./text";
import { CopilotA2UITextField } from "./text-field";
import { CopilotA2UIVideo } from "./video";

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

function implement(
  api: ComponentApi,
  component: Type<unknown>,
): CopilotA2UIComponentImplementation {
  return { name: api.name, schema: api.schema, component };
}

/** The A2UI basic components, styled like the Lit renderer's basic catalog. */
export const basicComponents: readonly CopilotA2UIComponentImplementation[] = [
  implement(TextApi, CopilotA2UIText),
  implement(ImageApi, CopilotA2UIImage),
  implement(IconApi, CopilotA2UIIcon),
  implement(VideoApi, CopilotA2UIVideo),
  implement(AudioPlayerApi, CopilotA2UIAudioPlayer),
  implement(RowApi, CopilotA2UIRow),
  implement(ColumnApi, CopilotA2UIColumn),
  implement(ListApi, CopilotA2UIList),
  implement(CardApi, CopilotA2UICard),
  implement(TabsApi, CopilotA2UITabs),
  implement(DividerApi, CopilotA2UIDivider),
  implement(ModalApi, CopilotA2UIModal),
  implement(ButtonApi, CopilotA2UIButton),
  implement(TextFieldApi, CopilotA2UITextField),
  implement(CheckBoxApi, CopilotA2UICheckBox),
  implement(ChoicePickerApi, CopilotA2UIChoicePicker),
  implement(SliderApi, CopilotA2UISlider),
  implement(DateTimeInputApi, CopilotA2UIDateTimeInput),
];

/**
 * The A2UI basic catalog rendered with Angular components. Pass it as
 * `a2ui.catalog`, or extend it with `createAngularCatalog(..., { includeBasicCatalog: true })`.
 */
export const basicCatalog = new CopilotA2UICatalog(
  BASIC_CATALOG_ID,
  [...basicComponents],
  BASIC_FUNCTIONS,
);
