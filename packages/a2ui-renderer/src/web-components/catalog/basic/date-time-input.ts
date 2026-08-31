import { html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { DateTimeInputApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { createLitComponent } from "../../adapter";
import { uniqueId } from "./ids";
import { LEAF_MARGIN, STANDARD_BORDER, STANDARD_RADIUS } from "./utils";

export const DateTimeInput = createLitComponent(
  DateTimeInputApi,
  ({ props }) => {
    const inputId = uniqueId("datetime");
    let type = "datetime-local";
    if (props.enableDate && !props.enableTime) type = "date";
    if (!props.enableDate && props.enableTime) type = "time";
    return html`
    <div
      style=${styleMap({
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        width: "100%",
        margin: LEAF_MARGIN,
      })}
    >
      ${
        props.label
          ? html`<label
            for=${inputId}
            style="font-size: 14px; font-weight: bold;"
            >${props.label}</label
          >`
          : nothing
      }
      <input
        id=${inputId}
        type=${type}
        style=${styleMap({
          padding: "8px",
          width: "100%",
          border: STANDARD_BORDER,
          borderRadius: STANDARD_RADIUS,
          boxSizing: "border-box",
        })}
        .value=${props.value || ""}
        min=${typeof props.min === "string" ? props.min : ""}
        max=${typeof props.max === "string" ? props.max : ""}
        @input=${(e: Event) =>
          props.setValue((e.target as HTMLInputElement).value)}
      />
    </div>
  `;
  },
);
