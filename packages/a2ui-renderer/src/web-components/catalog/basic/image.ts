import { html } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { ImageApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { createLitComponent } from "../../adapter";
import { getBaseLeafStyle } from "./utils";

export const Image = createLitComponent(ImageApi, ({ props }) => {
  const mapFit = (fit?: string): string => {
    if (fit === "scaleDown") return "scale-down";
    return fit || "fill";
  };
  const style: Record<string, string> = {
    ...getBaseLeafStyle(),
    objectFit: mapFit(props.fit),
    width: "100%",
    height: "auto",
    display: "block",
  } as Record<string, string>;

  if (props.variant === "icon") {
    style.width = "24px";
    style.height = "24px";
  } else if (props.variant === "avatar") {
    style.width = "40px";
    style.height = "40px";
    style.borderRadius = "50%";
  } else if (props.variant === "smallFeature") {
    style.maxWidth = "100px";
  } else if (props.variant === "largeFeature") {
    style.maxHeight = "400px";
  } else if (props.variant === "header") {
    style.height = "200px";
    style.objectFit = "cover";
  }

  return html`<img
    src=${props.url ?? ""}
    alt=${props.description ?? ""}
    style=${styleMap(style)}
  />`;
});
