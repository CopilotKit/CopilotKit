import type { LitComponentImplementation } from "../../types";
import { AudioPlayer } from "./audio-player";
import { Button } from "./button";
import { Card } from "./card";
import { CheckBox } from "./check-box";
import { ChoicePicker } from "./choice-picker";
import { Column } from "./column";
import { DateTimeInput } from "./date-time-input";
import { Divider } from "./divider";
import { Icon } from "./icon";
import { Image } from "./image";
import { List } from "./list";
import { Modal } from "./modal";
import { Row } from "./row";
import { Slider } from "./slider";
import { Tabs } from "./tabs";
import { Text } from "./text";
import { TextField } from "./text-field";
import { Video } from "./video";

export { AudioPlayer } from "./audio-player";
export { Button } from "./button";
export { Card } from "./card";
export { CheckBox } from "./check-box";
export { ChoicePicker } from "./choice-picker";
export { Column } from "./column";
export { DateTimeInput } from "./date-time-input";
export { Divider } from "./divider";
export { Icon } from "./icon";
export { Image } from "./image";
export { List } from "./list";
export { Modal } from "./modal";
export { Row } from "./row";
export { Slider } from "./slider";
export { Tabs } from "./tabs";
export { Text } from "./text";
export { TextField } from "./text-field";
export { Video } from "./video";

export const basicComponents: LitComponentImplementation[] = [
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
