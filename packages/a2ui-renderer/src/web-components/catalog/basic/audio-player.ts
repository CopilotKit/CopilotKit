import { html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { AudioPlayerApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { createLitComponent } from "../../adapter";
import { getBaseLeafStyle } from "./utils";

export const AudioPlayer = createLitComponent(AudioPlayerApi, ({ props }) => {
  const style = { ...getBaseLeafStyle(), width: "100%" };
  return html`
    <div
      style=${styleMap({
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        width: "100%",
      })}
    >
      ${
        props.description
          ? html`<span style="font-size: 12px; color: #666;"
            >${props.description}</span
          >`
          : nothing
      }
      <audio src=${props.url ?? ""} controls style=${styleMap(style)}></audio>
    </div>
  `;
});
