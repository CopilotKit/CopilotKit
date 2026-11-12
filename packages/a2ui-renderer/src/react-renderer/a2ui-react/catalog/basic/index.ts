/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Catalog } from "@a2ui/web_core/v0_9";
import { BASIC_FUNCTIONS } from "@a2ui/web_core/v0_9/basic_catalog";
import {
  BASIC_COMPONENTS as V1_COMPONENTS,
  BASIC_FUNCTIONS as V1_FUNCTIONS,
  BasicCatalogThemeSchema,
} from "@a2ui/web_core/catalogs/basic/v1";
import type { ReactComponentImplementation } from "../../adapter";

import { Text } from "./components/Text";
import { Image } from "./components/Image";
import { Icon } from "./components/Icon";
import { Video } from "./components/Video";
import { AudioPlayer } from "./components/AudioPlayer";
import { Row } from "./components/Row";
import { Column } from "./components/Column";
import { List } from "./components/List";
import { Card } from "./components/Card";
import { Tabs } from "./components/Tabs";
import { Divider } from "./components/Divider";
import { Modal } from "./components/Modal";
import { Button } from "./components/Button";
import { TextField } from "./components/TextField";
import { CheckBox } from "./components/CheckBox";
import { ChoicePicker } from "./components/ChoicePicker";
import { Slider } from "./components/Slider";
import { DateTimeInput } from "./components/DateTimeInput";

const basicComponents: ReactComponentImplementation[] = [
  Text,
  Image,
  Icon,
  Video,
  AudioPlayer,
  Row,
  Column,
  List,
  Card,
  Tabs,
  Divider,
  Modal,
  Button,
  TextField,
  CheckBox,
  ChoicePicker,
  Slider,
  DateTimeInput,
];

export const basicCatalog = new Catalog<ReactComponentImplementation>(
  "https://a2ui.org/specification/v0_9/basic_catalog.json",
  basicComponents,
  BASIC_FUNCTIONS,
);

/** Native A2UI 1.0 schemas and functions with the existing React renderers. */
export const basicCatalogV1 = new Catalog<ReactComponentImplementation>(
  "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
  "1.0",
  V1_COMPONENTS.map((api) => ({
    ...api,
    render: basicCatalog.components.get(api.name)!.render,
  })),
  V1_FUNCTIONS,
  { themeSchema: BasicCatalogThemeSchema },
);

export {
  Text,
  Image,
  Icon,
  Video,
  AudioPlayer,
  Row,
  Column,
  List,
  Card,
  Tabs,
  Divider,
  Modal,
  Button,
  TextField,
  CheckBox,
  ChoicePicker,
  Slider,
  DateTimeInput,
};
