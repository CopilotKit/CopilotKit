import { html } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { ColumnApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { createLitComponent } from "../../adapter";
import { renderChildList } from "../children";
import { mapAlign, mapJustify } from "./utils";

export const Column = createLitComponent(
  ColumnApi,
  ({ props, buildChild }) => html`
    <div
      style=${styleMap({
        display: "flex",
        flexDirection: "column",
        justifyContent: mapJustify(props.justify),
        alignItems: mapAlign(props.align),
        width: "100%",
        margin: "0",
        padding: "0",
      })}
    >
      ${renderChildList(props.children, buildChild)}
    </div>
  `,
);
