import { Check, ChevronDown } from "lucide-react";
import { useId } from "react";
import { UI_FORMATS } from "../lib/ui-format";
import type { UIFormat } from "../lib/ui-format";
import { useMenu } from "../lib/use-menu";

export function UIFormatPicker({
  value,
  onChange,
  disabled,
}: {
  value: UIFormat;
  onChange: (format: UIFormat) => void;
  disabled: boolean;
}) {
  const menu = useMenu(UI_FORMATS.length);
  const menuId = useId();
  const currentIndex = Math.max(
    0,
    UI_FORMATS.findIndex((format) => format.id === value),
  );
  const current = UI_FORMATS[currentIndex];

  return (
    <div
      className="model-picker ui-format-picker"
      data-placement="up"
      ref={menu.root}
    >
      <button
        ref={menu.button}
        type="button"
        className="model-picker__button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-label={`UI format: ${current.label}`}
        aria-expanded={menu.open}
        aria-controls={menuId}
        onClick={() => (menu.open ? menu.close() : menu.openAt(currentIndex))}
        onKeyDown={(event) => {
          if (!disabled && event.key === "ArrowDown" && !menu.open) {
            event.preventDefault();
            menu.openAt(currentIndex);
          }
        }}
      >
        <span>{current.label}</span>
        <ChevronDown size={14} strokeWidth={2} aria-hidden />
      </button>
      {menu.open && (
        <div
          className="model-picker__menu"
          role="menu"
          id={menuId}
          aria-label="UI format"
          onKeyDown={menu.onMenuKeyDown}
        >
          {UI_FORMATS.map((format, index) => (
            <button
              key={format.id}
              ref={menu.itemRef(index)}
              type="button"
              role="menuitemradio"
              disabled={disabled}
              aria-checked={format.id === value}
              tabIndex={index === menu.focusIndex ? 0 : -1}
              className="model-picker__item"
              onClick={() => {
                if (disabled) return;
                onChange(format.id);
                menu.close();
              }}
            >
              <span className="model-picker__label">{format.label}</span>
              {format.id === value && (
                <Check size={15} strokeWidth={2} aria-hidden />
              )}
            </button>
          ))}
          <p className="model-picker__note ui-format-picker__note">
            Starts a new question
          </p>
        </div>
      )}
    </div>
  );
}
