const PROBE_ATTRIBUTE = "data-copilotkit-style-probe";
/** The value the probe rule in base.css gives every side. */
const PROBE_VALUE = "1px";
/** Set by the probe rule, so its presence shows the stylesheet is in the page. */
const LOADED_PROPERTY = "--cpk-style-probe";
const PROPERTIES = ["padding", "margin"] as const;
const SIDES = ["top", "right", "bottom", "left"] as const;

const MIGRATION_GUIDE_URL =
  "https://docs.copilotkit.ai/migrate/v2#if-the-chat-has-no-padding-move-your-css-reset-into-a-layer";

/** A property of CopilotKit's UI that an app's CSS can override. */
export type ɵStyleOverride = (typeof PROPERTIES)[number];

/**
 * Finds out whether a CSS rule outside a cascade layer, such as the
 * `* { padding: 0; margin: 0 }` reset of many app templates, overrides
 * CopilotKit's styles. CopilotKit's stylesheet is in cascade layers, so any
 * unlayered rule wins over it.
 *
 * Adds a hidden probe element to `document`, reads its computed padding and
 * margin, and removes it. Call it after the stylesheet is in the page.
 *
 * @param document - The document that holds CopilotKit's stylesheet.
 * @returns The overridden properties (empty when nothing is overridden), or
 *   `null` when the stylesheet is not in the page or `document` has no window.
 */
export function ɵdetectStyleOverrides(document: Document) {
  const view = document.defaultView;
  if (!view) return null;

  const probe = document.createElement("div");
  probe.setAttribute("data-copilotkit", "");
  probe.setAttribute(PROBE_ATTRIBUTE, "");
  probe.setAttribute("aria-hidden", "true");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  document.body.append(probe);

  const style = view.getComputedStyle(probe);
  const isStylesheetLoaded =
    style.getPropertyValue(LOADED_PROPERTY).trim() !== "";
  const overrides = isStylesheetLoaded
    ? PROPERTIES.filter((property) =>
        SIDES.some(
          (side) =>
            style.getPropertyValue(`${property}-${side}`) !== PROBE_VALUE,
        ),
      )
    : null;
  probe.remove();
  return overrides;
}

const checkedDocuments = new WeakSet<Document>();

/**
 * Logs a console warning when an app's CSS overrides CopilotKit's styles (see
 * {@link ɵdetectStyleOverrides}). Checks each document once: later calls do
 * nothing. When the stylesheet is not in the page yet, a later call checks
 * again.
 *
 * The framework packages call it in development, after they add the
 * stylesheet. It does not check the environment itself.
 *
 * @param document - The document that holds CopilotKit's stylesheet.
 */
export function ɵwarnIfStylesOverridden(document: Document) {
  if (checkedDocuments.has(document)) return;
  const overrides = ɵdetectStyleOverrides(document);
  if (overrides === null) return;
  checkedDocuments.add(document);
  if (overrides.length === 0) return;

  console.warn(
    `[CopilotKit] A global CSS rule outside a cascade layer, such as ` +
      `\`* { padding: 0; margin: 0 }\`, overrides the ${overrides.join(" and ")} ` +
      `of CopilotKit's UI. CopilotKit's styles are in cascade layers, and any ` +
      `rule outside a layer wins over them. Move the rule into a layer: ` +
      `\`@layer base { * { padding: 0; margin: 0 } }\`. See ${MIGRATION_GUIDE_URL}`,
  );
}
