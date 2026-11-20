import {
  mediaDeclarations,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import CopilotGenerativeUIAudioPlayer from "./AudioPlayer.vue";
import CopilotGenerativeUIFavicon from "./Favicon.vue";
import CopilotGenerativeUIHtmlView from "./HtmlView.vue";
import CopilotGenerativeUIIcon from "./Icon.vue";
import CopilotGenerativeUIImage from "./Image.vue";
import CopilotGenerativeUILucideIcon from "./LucideIcon.vue";
import CopilotGenerativeUISvg from "./Svg.vue";
import CopilotGenerativeUIVideo from "./Video.vue";

export {
  CopilotGenerativeUIAudioPlayer,
  CopilotGenerativeUIFavicon,
  CopilotGenerativeUIHtmlView,
  CopilotGenerativeUIIcon,
  CopilotGenerativeUIImage,
  CopilotGenerativeUILucideIcon,
  CopilotGenerativeUISvg,
  CopilotGenerativeUIVideo,
};
export { ICON_PX, kebabToPascal, lucideNameOf } from "./icons";
export { videoSourceOf, youTubeIdOf } from "./video-source";
export type { VideoSource } from "./video-source";

/**
 * The standard media components: the shared declarations with the Vue
 * components. Give them to `createGenerativeUI`:
 *
 * @example
 * ```ts
 * const ui = createGenerativeUI({
 *   id: "my-app/ui@1",
 *   components: { ...mediaComponents },
 * });
 * ```
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
