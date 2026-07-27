import { html } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { IconApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { createLitComponent } from "../../adapter";
import { getBaseLeafStyle } from "./utils";

export const Icon = createLitComponent(IconApi, ({ props }) => {
  const iconName =
    typeof props.name === "string"
      ? props.name
      : (props.name as { path?: string } | undefined)?.path;
  return html`
    <span
      class="material-symbols-outlined"
      style=${styleMap({
        ...getBaseLeafStyle(),
        fontSize: "24px",
        width: "24px",
        height: "24px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      })}
      >${iconName}</span
    >
  `;
});
