import { html } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { RowApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { createLitComponent } from "../../adapter";
import { renderChildList } from "../children";
import { mapAlign, mapJustify } from "./utils";

export const Row = createLitComponent(
  RowApi,
  ({ props, buildChild }) => html`
  <div
    style=${styleMap({
      display: "flex",
      flexDirection: "row",
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
