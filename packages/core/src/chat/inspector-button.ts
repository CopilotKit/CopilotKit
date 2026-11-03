// Page-lifetime preference, shared by every message and chat. Deliberately
// not in sessionStorage: that survives reloads, and this must not.
let shortcutsHidden = false;
const shortcutListeners = new Set<() => void>();

const notifyShortcutListeners = () => {
  for (const listener of shortcutListeners) listener();
};

/**
 * Whether the user hid the Inspector shortcuts in the message toolbars
 * ("Hide this icon"). It lasts until the page reloads and applies to every
 * chat on the page.
 *
 * @example
 * ```ts
 * ɵinspectorShortcuts.subscribe(() => render(ɵinspectorShortcuts.hidden));
 * ɵinspectorShortcuts.hide();
 * ```
 */
export const ɵinspectorShortcuts = {
  /** Whether the shortcuts are hidden. */
  get hidden() {
    return shortcutsHidden;
  },
  /** Hides the shortcuts of every message until the page reloads. */
  hide() {
    if (shortcutsHidden) return;
    shortcutsHidden = true;
    notifyShortcutListeners();
  },
  /** Calls `listener` when `hidden` changes. Returns the unsubscribe function. */
  subscribe(listener: () => void) {
    shortcutListeners.add(listener);
    return () => {
      shortcutListeners.delete(listener);
    };
  },
  /** @internal Shows the shortcuts again, so each test starts fresh. */
  reset() {
    if (!shortcutsHidden) return;
    shortcutsHidden = false;
    notifyShortcutListeners();
  },
};

/** One path of the Inspector kite artwork. */
export interface ɵInspectorKitePath {
  readonly d: string;
  /** The id suffix of the gradient that fills it. */
  readonly fillGradient?: string;
  readonly stroke?: string;
  readonly strokeWidth?: string;
  readonly strokeLinecap?: "round";
}

/** One gradient stop. Without `offset` the stop sits at 0. */
export interface ɵInspectorKiteStop {
  readonly offset?: string;
  readonly color: string;
}

/** One linear gradient, in user space. */
export interface ɵInspectorKiteGradient {
  /** Appended to a per-instance prefix, so two icons on a page do not clash. */
  readonly id: string;
  readonly x1: string;
  readonly y1: string;
  readonly x2: string;
  readonly y2: string;
  readonly stops: readonly ɵInspectorKiteStop[];
}

/** Artwork drawn from paths and gradients. See {@link ɵinspectorKiteIcon}. */
export interface ɵInspectorKiteArtwork {
  readonly viewBox: string;
  readonly paths: readonly ɵInspectorKitePath[];
  readonly gradients: readonly ɵInspectorKiteGradient[];
}

const kiteStroke = (d: string, stroke: string, strokeWidth: string) => ({
  d,
  stroke,
  strokeWidth,
  strokeLinecap: "round" as const,
});

/**
 * The Inspector kite artwork as data, as in
 * `web-inspector/src/assets/inspector-logo-kite.svg`. Render an `<svg>` with
 * `viewBox` and `fill="none"`, one `<path>` per entry of `paths`, and a
 * `<linearGradient gradientUnits="userSpaceOnUse">` per entry of `gradients`
 * in `<defs>`. Give each gradient the id `${prefix}-${gradient.id}` with a
 * prefix unique to the icon, and fill paths with
 * {@link ɵinspectorKiteFill}.
 */
export const ɵinspectorKiteIcon: ɵInspectorKiteArtwork = {
  viewBox: "4.57 3.36 17.8 17.8",
  paths: [
    {
      d: "M6.36084 10.9855C8.34277 8.393 9.98843 5.82939 10.6204 3.75914C10.6382 3.70281 10.7043 3.67888 10.7534 3.7114C12.9536 5.16894 16.9635 6.12833 20.5086 6.15085C20.5703 6.15124 20.6124 6.2114 20.5895 6.26829C19.4109 9.25938 17.9705 14.6189 17.9148 20.7392C17.9148 20.8301 17.7873 20.8627 17.7419 20.7837C15.7236 17.2522 9.26021 12.2898 6.39414 11.1186C6.34112 11.0968 6.32556 11.0313 6.36084 10.9855Z",
      fillGradient: "paint0_linear",
    },
    {
      d: "M13.0475 9.39974C9.95016 10.3806 7.11935 10.9259 6.44331 11.0498C6.40027 11.0577 6.39115 11.1172 6.43152 11.134C9.3203 12.3347 15.7516 17.2826 17.7511 20.7998C17.7551 20.8075 17.7647 20.8103 17.7728 20.8068C17.7809 20.803 17.7853 20.793 17.7819 20.7844L13.0475 9.39974Z",
      fillGradient: "paint1_linear",
    },
    {
      d: "M10.762 3.705C13.4137 5.15161 16.4787 5.80132 20.545 6.14367C20.5703 6.14585 20.5787 6.18008 20.5557 6.19197C20.0359 6.45923 17.0574 7.97512 14.8455 8.78701C14.2524 9.00453 13.6564 9.20632 13.0692 9.39249C13.0562 9.39656 13.0419 9.39015 13.0369 9.37774L10.7005 3.75979C10.6849 3.72196 10.7257 3.68538 10.762 3.705Z",
      fillGradient: "paint2_linear",
    },
    kiteStroke("M10.7145 3.79041L17.8305 20.7659", "#513C9F", "0.17284"),
    kiteStroke(
      "M6.44531 11.0476C6.44531 11.0476 10.375 10.3422 14.0686 9.06804C17.7623 7.7939 20.5122 6.23373 20.5122 6.23373",
      "#513C9F",
      "0.17284",
    ),
    kiteStroke(
      "M11.6914 5.93518L9.05534 14.7068M9.05534 14.7068H15.3203M9.05534 14.7068L0.15625 26.3646",
      "#ABABAB",
      "0.302474",
    ),
    {
      d: "M6.02539 23.9646L4.85806 24.1287C5.46272 25.7287 6.70381 26.4276 8.18528 26.4276C11.8147 26.4276 10.707 22.3227 12.8103 22.3227C14.3358 22.3227 13.7155 25.6498 16.9992 25.6498C19.0029 25.6498 19.2028 23.631 18.8607 22.7625C18.8589 22.7572 18.8568 22.7524 18.8538 22.7476L18.3166 21.9253C18.2817 21.8706 18.1968 21.8912 18.1907 21.9562L18.0908 22.9529C18.0838 23.0222 18.0857 23.0913 18.0936 23.1605C18.1764 23.8491 18.2291 25.5202 16.9992 25.5202C15.7015 25.5202 15.3895 22.2362 12.8103 22.2362C9.78393 22.2362 10.1726 26.298 8.31487 26.298C7.08938 26.298 6.15447 24.9153 6.02539 23.9646Z",
      fillGradient: "paint3_linear",
    },
  ],
  gradients: [
    {
      id: "paint0_linear",
      x1: "15.5372",
      y1: "5.0278",
      x2: "12.0802",
      y2: "14.534",
      stops: [{ color: "#6430AB" }, { offset: "1", color: "#AA89D8" }],
    },
    {
      id: "paint1_linear",
      x1: "12.8583",
      y1: "10.3858",
      x2: "8.40764",
      y2: "18.9846",
      stops: [{ color: "#005DBB" }, { offset: "1", color: "#3D92E8" }],
    },
    {
      id: "paint2_linear",
      x1: "14.8452",
      y1: "5.02774",
      x2: "13.5047",
      y2: "9.21911",
      stops: [{ color: "#1B70C4" }, { offset: "1", color: "#54A4F2" }],
    },
    {
      id: "paint3_linear",
      x1: "4.85806",
      y1: "24.2455",
      x2: "18.9963",
      y2: "24.2455",
      stops: [
        { color: "#4497EA" },
        { offset: "0.254755", color: "#1463B2" },
        { offset: "0.498725", color: "#0A437D" },
        { offset: "0.666667", color: "#2476C8" },
        { offset: "0.972542", color: "#0C549A" },
      ],
    },
  ],
};

/**
 * The `fill` of a kite path: its gradient under the icon's id `prefix`, or
 * `undefined` for a stroke-only path.
 */
export function ɵinspectorKiteFill(prefix: string, path: ɵInspectorKitePath) {
  return path.fillGradient === undefined
    ? undefined
    : `url(#${prefix}-${path.fillGradient})`;
}

/** How long a hover-opened menu stays after the pointer leaves, in ms. */
export const ɵHOVER_MENU_CLOSE_DELAY_MS = 180;

/** What a hover menu shows. */
export interface ɵHoverMenuState {
  readonly open: boolean;
  /** The trigger sat inside a `.dark` element when the menu opened. */
  readonly dark: boolean;
}

/**
 * The open state of a menu that opens when the pointer reaches its trigger,
 * like the Inspector shortcut's menu.
 *
 * - A mouse or pen over the trigger opens it; touch does not.
 * - Leaving the trigger or the menu closes it after `closeDelayMs`, unless
 *   the pointer comes back first or the keyboard has used the menu since.
 * - Opening reads whether the trigger is inside a `.dark` element, so a menu
 *   in a portal can match the theme.
 *
 * Frameworks render from `getSnapshot()` and re-render when `subscribe()`
 * notifies. Call `dispose()` on unmount; the controller stays usable.
 */
export class ɵHoverMenuController {
  readonly #closeDelayMs: number;
  readonly #listeners = new Set<() => void>();
  #state: ɵHoverMenuState = { open: false, dark: false };
  #timer: ReturnType<typeof setTimeout> | undefined;
  #openedByHover = false;

  constructor({
    closeDelayMs = ɵHOVER_MENU_CLOSE_DELAY_MS,
  }: { closeDelayMs?: number } = {}) {
    this.#closeDelayMs = closeDelayMs;
  }

  /** The current state. The same object until something changes. */
  getSnapshot = () => this.#state;

  /** Calls `listener` when the state changes. Returns the unsubscribe function. */
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Whether the pointer opened the menu and the keyboard has not used it. */
  get openedByHover() {
    return this.#openedByHover;
  }

  /**
   * Opens or closes the menu and stops a pending close. `trigger` is read on
   * open for the dark theme.
   */
  setOpen = (open: boolean, trigger?: Element | null) => {
    this.cancelClose();
    const dark = open ? !!trigger?.closest(".dark") : this.#state.dark;
    if (open === this.#state.open && dark === this.#state.dark) return;
    this.#state = { open, dark };
    for (const listener of this.#listeners) listener();
  };

  /** The pointer reached the trigger: opens, except for touch or disabled. */
  pointerEnter = ({
    pointerType,
    disabled = false,
    trigger,
  }: {
    pointerType: string;
    disabled?: boolean;
    trigger: Element | null;
  }) => {
    if (disabled || pointerType === "touch") return;
    this.#openedByHover = true;
    this.setOpen(true, trigger);
  };

  /** The keyboard used the trigger or the menu: keep it open on leave. */
  keyboardUsed = () => {
    this.#openedByHover = false;
  };

  /** The pointer left the trigger or the menu: close soon if hover opened it. */
  scheduleClose = () => {
    this.cancelClose();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (this.#openedByHover) this.setOpen(false);
    }, this.#closeDelayMs);
  };

  /** The pointer came back: keep the menu open. */
  cancelClose = () => {
    if (this.#timer === undefined) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  };

  /** Stops a pending close. */
  dispose = () => {
    this.cancelClose();
  };
}
