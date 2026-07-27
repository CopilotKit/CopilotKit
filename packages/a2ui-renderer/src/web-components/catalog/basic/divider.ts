import { html } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { DividerApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { createLitComponent } from "../../adapter";
import { LEAF_MARGIN } from "./utils";

export const Divider = createLitComponent(DividerApi, ({ props }) => {
  const isVertical = props.axis === "vertical";
  const style: Record<string, string> = {
    margin: LEAF_MARGIN,
    border: "none",
    backgroundColor: "#ccc",
    width: isVertical ? "1px" : "100%",
    height: isVertical ? "100%" : "1px",
  };
  return html`<div style=${styleMap(style)}></div>`;
});
