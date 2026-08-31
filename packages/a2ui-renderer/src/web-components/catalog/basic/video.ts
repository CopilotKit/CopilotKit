import { html } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { VideoApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { createLitComponent } from "../../adapter";
import { getBaseLeafStyle } from "./utils";

export const Video = createLitComponent(
  VideoApi,
  ({ props }) => html`
  <video
    src=${props.url ?? ""}
    controls
    style=${styleMap({
      ...getBaseLeafStyle(),
      width: "100%",
      aspectRatio: "16/9",
    })}
  ></video>
`,
);
