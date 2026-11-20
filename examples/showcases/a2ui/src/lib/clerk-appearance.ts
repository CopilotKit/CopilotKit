/**
 * Clerk's sign-in, sign-up and account menu inside the desk's design system.
 *
 * Clerk draws its components flush (no card of its own) inside our sheet,
 * and puts its styles in a cascade layer, so `app.css` styles every part
 * through Clerk's stable `cl-*` classes (see "Sign in" there). The variables
 * cover what CSS does not reach, like the account menu's popover. Every
 * value is a token from `src/styles/tokens.css`, so light and dark follow
 * the rest of the app.
 */
export const CLERK_APPEARANCE = {
  cssLayerName: "clerk",
  elevation: "flush" as const,
  options: {
    socialButtonsVariant: "blockButton" as const,
    logoPlacement: "none" as const,
    shimmer: false,
    // Clerk animates its card's height between steps; the desk keeps still.
    animations: false,
    // The development instance's banner; production has none anyway.
    unsafe_disableDevelopmentModeWarnings: true,
  },
  variables: {
    colorPrimary: "var(--desk-accent)",
    colorPrimaryForeground: "var(--on-accent)",
    colorDanger: "var(--signal-danger)",
    colorSuccess: "var(--signal-ok)",
    colorWarning: "var(--signal-warn)",
    colorForeground: "var(--ink-strong)",
    colorMutedForeground: "var(--ink-muted)",
    colorMuted: "var(--sand)",
    colorBackground: "var(--sheet)",
    colorInput: "var(--control)",
    colorInputForeground: "var(--ink-strong)",
    colorBorder: "var(--control-edge)",
    colorRing: "var(--focus)",
    colorShadow: "rgb(7 54 66 / 0.18)",
    colorModalBackdrop: "var(--scrim-light)",
    colorNeutral: "var(--ink)",
    fontFamily: "var(--font-sans)",
    borderRadius: "var(--radius)",
  },
};

/** Clerk's words, in the desk's: why a reader would sign in at all. */
export const CLERK_LOCALIZATION = {
  signIn: {
    start: {
      title: "Sign in",
      subtitle: "Keep your threads and let the agent work in your Google apps.",
    },
  },
  signUp: {
    start: {
      title: "Create your account",
      subtitle: "Keep your threads and let the agent work in your Google apps.",
    },
  },
};
