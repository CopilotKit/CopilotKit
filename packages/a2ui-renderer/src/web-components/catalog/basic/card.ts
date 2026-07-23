import { html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { CardApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { createLitComponent } from "../../adapter";
import { getBaseContainerStyle } from "./utils";

export const Card = createLitComponent(
  CardApi,
  ({ props, buildChild }) => html`
  <div
    style=${styleMap({
      ...getBaseContainerStyle(),
      backgroundColor: "#fff",
      boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
      width: "100%",
    })}
  >
    ${props.child ? buildChild(props.child) : nothing}
  </div>
`,
);
