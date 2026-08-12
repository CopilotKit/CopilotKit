import { html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { ChoicePickerApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { createLitComponent } from "../../adapter";
import { LEAF_MARGIN, STANDARD_BORDER, STANDARD_RADIUS } from "./utils";

export const ChoicePicker = createLitComponent(
  ChoicePickerApi,
  ({ props, context, state, requestUpdate }) => {
    const local = state as { filter: string };
    const values = Array.isArray(props.value) ? props.value : [];
    const isMutuallyExclusive = props.variant === "mutuallyExclusive";
    const onToggle = (val: string) => {
      if (isMutuallyExclusive) {
        props.setValue([val]);
      } else {
        props.setValue(
          values.includes(val)
            ? values.filter((v: string) => v !== val)
            : [...values, val],
        );
      }
    };
    const options = (props.options || []).filter(
      (opt: any) =>
        !props.filterable ||
        local.filter === "" ||
        String(opt.label).toLowerCase().includes(local.filter.toLowerCase()),
    );

    return html`
      <div
        style=${styleMap({
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          margin: LEAF_MARGIN,
          width: "100%",
        })}
      >
        ${
          props.label
            ? html`<strong style="font-size: 14px;">${props.label}</strong>`
            : nothing
        }
        ${
          props.filterable
            ? html`<input
              type="text"
              placeholder="Filter options..."
              .value=${local.filter}
              @input=${(e: Event) => {
                local.filter = (e.target as HTMLInputElement).value;
                requestUpdate();
              }}
              style=${styleMap({
                padding: "4px 8px",
                border: STANDARD_BORDER,
                borderRadius: STANDARD_RADIUS,
              })}
            />`
            : nothing
        }
        <div
          style=${styleMap({
            display: "flex",
            flexDirection: props.displayStyle === "chips" ? "row" : "column",
            flexWrap: props.displayStyle === "chips" ? "wrap" : "nowrap",
            gap: "8px",
          })}
        >
          ${options.map((opt: any) => {
            const isSelected = values.includes(opt.value);
            if (props.displayStyle === "chips") {
              return html`
                <button
                  type="button"
                  @click=${() => onToggle(opt.value)}
                  style=${styleMap({
                    padding: "4px 12px",
                    borderRadius: "16px",
                    border: isSelected
                      ? "1px solid var(--a2ui-primary-color, #007bff)"
                      : STANDARD_BORDER,
                    backgroundColor: isSelected
                      ? "var(--a2ui-primary-color, #007bff)"
                      : "#fff",
                    color: isSelected ? "#fff" : "inherit",
                    cursor: "pointer",
                    fontSize: "12px",
                  })}
                >
                  ${opt.label}
                </button>
              `;
            }
            return html`
              <label
                style="display: flex; align-items: center; gap: 8px; cursor: pointer;"
              >
                <input
                  type=${isMutuallyExclusive ? "radio" : "checkbox"}
                  .checked=${isSelected}
                  name=${
                    isMutuallyExclusive
                      ? `choice-${context.componentModel.id}`
                      : ""
                  }
                  @change=${() => onToggle(opt.value)}
                />
                <span style="font-size: 14px;">${opt.label}</span>
              </label>
            `;
          })}
        </div>
      </div>
    `;
  },
  () => ({ filter: "" }),
);
