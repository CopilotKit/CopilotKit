import { html } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { TextApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { createLitComponent } from "../../adapter";
import { getBaseLeafStyle } from "./utils";

export const Text = createLitComponent(TextApi, ({ props }) => {
  const text = props.text ?? "";
  const style = { ...getBaseLeafStyle(), display: "inline-block" };

  switch (props.variant) {
    case "h1":
      return html`<h1 style=${styleMap(style)}>${text}</h1>`;
    case "h2":
      return html`<h2 style=${styleMap(style)}>${text}</h2>`;
    case "h3":
      return html`<h3 style=${styleMap(style)}>${text}</h3>`;
    case "h4":
      return html`<h4 style=${styleMap(style)}>${text}</h4>`;
    case "h5":
      return html`<h5 style=${styleMap(style)}>${text}</h5>`;
    case "caption":
      return html`
        <small
          style=${styleMap({ ...style, color: "#666", textAlign: "left" })}
          >${text}</small
        >
      `;
    case "body":
    default:
      return html`<span style=${styleMap(style)}>${text}</span>`;
  }
});
