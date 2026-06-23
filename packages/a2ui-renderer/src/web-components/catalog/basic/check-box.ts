import { html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { CheckBoxApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { createLitComponent } from "../../adapter";
import { uniqueId } from "./ids";
import { LEAF_MARGIN } from "./utils";

export const CheckBox = createLitComponent(CheckBoxApi, ({ props }) => {
  const inputId = uniqueId("checkbox");
  const hasError = props.validationErrors && props.validationErrors.length > 0;
  return html`
    <div
      style=${styleMap({
        display: "flex",
        flexDirection: "column",
        margin: LEAF_MARGIN,
      })}
    >
      <div style="display: flex; align-items: center; gap: 8px;">
        <input
          id=${inputId}
          type="checkbox"
          .checked=${!!props.value}
          @change=${(e: Event) =>
            props.setValue((e.target as HTMLInputElement).checked)}
          style=${styleMap({
            cursor: "pointer",
            outline: hasError ? "1px solid red" : "none",
          })}
        />
        ${
          props.label
            ? html`<label
              for=${inputId}
              style=${styleMap({
                cursor: "pointer",
                color: hasError ? "red" : "inherit",
              })}
              >${props.label}</label
            >`
            : nothing
        }
      </div>
      ${
        hasError
          ? html`<span
            style="font-size: 12px; color: red; margin-top: 4px;"
            >${props.validationErrors?.[0]}</span
          >`
          : nothing
      }
    </div>
  `;
});
