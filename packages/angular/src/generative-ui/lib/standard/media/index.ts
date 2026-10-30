import {
  mediaDeclarations,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import { CopilotGenerativeUIHtmlView } from "./html-view";
import { CopilotGenerativeUIIcon, CopilotGenerativeUISvg } from "./icon";
import { CopilotGenerativeUIFavicon, CopilotGenerativeUIImage } from "./image";
import {
  CopilotGenerativeUIAudioPlayer,
  CopilotGenerativeUIVideo,
} from "./video";

export { CopilotGenerativeUIHtmlView } from "./html-view";
export { CopilotGenerativeUIIcon, CopilotGenerativeUISvg } from "./icon";
export { CopilotGenerativeUIFavicon, CopilotGenerativeUIImage } from "./image";
export {
  CopilotGenerativeUIAudioPlayer,
  CopilotGenerativeUIVideo,
  videoSourceOf,
  youTubeIdOf,
} from "./video";

/**
 * The standard media components. Give them to
 * `createGenerativeUI({ components: { ...mediaComponents } })`.
 */
export const mediaComponents = withComponents(mediaDeclarations, {
  Image: CopilotGenerativeUIImage,
  Icon: CopilotGenerativeUIIcon,
  Favicon: CopilotGenerativeUIFavicon,
  Svg: CopilotGenerativeUISvg,
  Video: CopilotGenerativeUIVideo,
  AudioPlayer: CopilotGenerativeUIAudioPlayer,
  HtmlView: CopilotGenerativeUIHtmlView,
});
