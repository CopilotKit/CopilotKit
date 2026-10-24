import { ImagePlus, Plus } from "lucide-react";
import { useId } from "react";
import type { CSSProperties } from "react";
import { useMenu } from "../lib/use-menu";
import { VIEW_CATALOG } from "../lib/view-catalog";
import type { ViewKind } from "../lib/view-catalog";

/**
 * The composer's + menu: attach a picture from the reader's device, or pick
 * a view from the catalog for the agent to answer with.
 */
export function AddMenu({
  onAddImage,
  onPickView,
  picked,
}: {
  /** Opens the file picker; absent when attachments are off. */
  onAddImage?: () => void;
  onPickView: (view: ViewKind) => void;
  picked: ViewKind | null;
}) {
  // The picture item, when there is one, comes before the views.
  const offset = onAddImage ? 1 : 0;
  const menu = useMenu(VIEW_CATALOG.length + offset);
  const menuId = useId();

  return (
    <div className="add-menu" ref={menu.root}>
      <button
        ref={menu.button}
        type="button"
        className="composer__icon-button"
        aria-label="Add a picture or ask for a view"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-controls={menuId}
        onClick={menu.toggle}
      >
        <Plus size={15} strokeWidth={2} aria-hidden />
      </button>
      {menu.open && (
        <div
          className="add-menu__panel"
          role="menu"
          id={menuId}
          aria-label="Add"
          onKeyDown={menu.onMenuKeyDown}
        >
          {onAddImage && (
            <button
              ref={menu.itemRef(0)}
              type="button"
              role="menuitem"
              tabIndex={menu.focusIndex === 0 ? 0 : -1}
              className="add-menu__attach"
              onClick={() => {
                menu.close();
                onAddImage();
              }}
            >
              <ImagePlus size={16} strokeWidth={2} aria-hidden />
              <span>
                <span className="add-menu__label">Attach a picture</span>
                <span className="add-menu__note">
                  A photo or screenshot for the agent to read
                </span>
              </span>
            </button>
          )}
          <div
            className="add-menu__group"
            role="group"
            aria-labelledby={`${menuId}-views`}
          >
            <span className="add-menu__heading" id={`${menuId}-views`}>
              Answer with
            </span>
            <div className="add-menu__grid">
              {VIEW_CATALOG.map((view, index) => {
                const Icon = view.icon;
                const at = index + offset;
                return (
                  <button
                    key={view.id}
                    ref={menu.itemRef(at)}
                    type="button"
                    role="menuitemradio"
                    aria-checked={picked?.id === view.id}
                    tabIndex={menu.focusIndex === at ? 0 : -1}
                    className="add-menu__view"
                    style={{ "--view-tone": view.tone } as CSSProperties}
                    onClick={() => {
                      onPickView(view);
                      menu.close();
                    }}
                  >
                    <span className="add-menu__icon" aria-hidden>
                      <Icon size={16} strokeWidth={2} />
                    </span>
                    <span>
                      <span className="add-menu__label">{view.label}</span>
                      <span className="add-menu__note">{view.note}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
