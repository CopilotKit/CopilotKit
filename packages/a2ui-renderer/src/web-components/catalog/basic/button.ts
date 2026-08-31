import { html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { ButtonApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { createLitComponent } from "../../adapter";
import { LEAF_MARGIN } from "./utils";

export const Button = createLitComponent(
  ButtonApi,
  ({ props, buildChild }) => html`
    <button
      type="button"
      style=${styleMap({
        margin: LEAF_MARGIN,
        padding: "8px 16px",
        cursor: "pointer",
        border: props.variant === "borderless" ? "none" : "1px solid #ccc",
        backgroundColor:
          props.variant === "primary"
            ? "var(--a2ui-primary-color, #007bff)"
            : props.variant === "borderless"
              ? "transparent"
              : "#fff",
        color: props.variant === "primary" ? "#fff" : "inherit",
        borderRadius: "4px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
      })}
      ?disabled=${props.isValid === false}
      @click=${() => props.action?.()}
    >
      ${props.child ? buildChild(props.child) : nothing}
    </button>
  `,
);
