import { html } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { ListApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { createLitComponent } from "../../adapter";
import { renderChildList } from "../children";
import { mapAlign } from "./utils";

export const List = createLitComponent(ListApi, ({ props, buildChild }) => {
  const isHorizontal = props.direction === "horizontal";
  return html`
    <div
      style=${styleMap({
        display: "flex",
        flexDirection: isHorizontal ? "row" : "column",
        alignItems: mapAlign(props.align),
        overflowX: isHorizontal ? "auto" : "hidden",
        overflowY: isHorizontal ? "hidden" : "auto",
        width: "100%",
        margin: "0",
        padding: "0",
      })}
    >
      ${renderChildList(props.children, buildChild)}
    </div>
  `;
});
