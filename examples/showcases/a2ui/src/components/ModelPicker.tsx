import { Check, ChevronDown } from "lucide-react";
import { useId } from "react";
import { useMenu } from "../lib/use-menu";
import { MODELS } from "../lib/models";
import type { ModelId } from "../lib/models";

export function ModelPicker({
  value,
  onChange,
  placement = "down",
}: {
  value: ModelId;
  onChange: (model: ModelId) => void;
  /** Which way the menu opens; "up" inside the composer. */
  placement?: "up" | "down";
}) {
  const menu = useMenu(MODELS.length);
  const menuId = useId();
  const currentIndex = Math.max(
    0,
    MODELS.findIndex((model) => model.id === value),
  );
  const current = MODELS[currentIndex];

  return (
    <div className="model-picker" data-placement={placement} ref={menu.root}>
      <button
        ref={menu.button}
        type="button"
        className="model-picker__button"
        aria-haspopup="menu"
        aria-label={`Model: ${current.label}`}
        aria-expanded={menu.open}
        aria-controls={menuId}
        onClick={() => (menu.open ? menu.close() : menu.openAt(currentIndex))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !menu.open) {
            event.preventDefault();
            menu.openAt(currentIndex);
          }
        }}
      >
        <span className="model-picker__dot" aria-hidden />
        <span>
          <span className="model-picker__family">Gemini </span>
          {current.label.replace(/^Gemini /, "")}
        </span>
        <ChevronDown size={14} strokeWidth={2} aria-hidden />
      </button>
      {menu.open && (
        <div
          className="model-picker__menu"
          role="menu"
          id={menuId}
          aria-label="Model"
          onKeyDown={menu.onMenuKeyDown}
        >
          {MODELS.map((model, index) => (
            <button
              key={model.id}
              ref={menu.itemRef(index)}
              type="button"
              role="menuitemradio"
              aria-checked={model.id === value}
              tabIndex={index === menu.focusIndex ? 0 : -1}
              className="model-picker__item"
              onClick={() => {
                onChange(model.id);
                menu.close();
              }}
            >
              <span className="model-picker__text">
                <span className="model-picker__label">{model.label}</span>
                <span className="model-picker__note">{model.note}</span>
              </span>
              {model.id === value && (
                <Check size={15} strokeWidth={2} aria-hidden />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
