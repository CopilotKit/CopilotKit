/**
 * Open Generative UI content: the activity the agent streams while it
 * generates a sandboxed UI, and the rules for when a new snapshot must reach
 * the sandbox at once.
 */

/** The activity type of Open Generative UI messages. */
export const OPEN_GENERATIVE_UI_ACTIVITY_TYPE = "open-generative-ui";

/** The name of the frontend tool the agent calls to generate a sandboxed UI. */
export const GENERATE_SANDBOXED_UI_TOOL_NAME = "generateSandboxedUi";

/** The design guidance sent to the agent when no `designSkill` is set. */
export const DEFAULT_OPEN_GENERATIVE_UI_DESIGN_SKILL = `When generating UI with generateSandboxedUi, follow these design principles inspired by shadcn/ui:

- Use a minimal, flat aesthetic. Avoid drop shadows and gradients — rely on subtle borders (1px solid, light gray like #e5e7eb) to define surfaces.
- Neutral base palette: white backgrounds, zinc/slate gray text (#09090b for headings, #71717a for secondary text). One accent color for interactive elements.
- Use system font stacks (system-ui, -apple-system, sans-serif) at readable sizes (14px body, 600 weight for headings). Tight line-heights.
- Small, consistent border-radius (6–8px). Cards and containers use border, not shadow, for separation.
- Buttons: solid fill for primary (dark bg, white text), outline for secondary (border + transparent bg). Subtle hover state (slight opacity or background shift).
- Use CSS Grid or Flexbox for layout. Ensure the UI looks good at any width.
- Minimal transitions (150ms) for hover/focus states only. No decorative animations.
- Keep the UI focused and dense — avoid excessive padding. Use compact spacing (8–12px gaps, 10–14px padding in controls).`;

/** The content of an Open Generative UI activity message. */
export type OpenGenerativeUIContent = {
  /** Height in pixels before the generated UI is measured. */
  initialHeight?: number;
  /** `false` once the agent has finished generating. */
  generating?: boolean;
  css?: string;
  cssComplete?: boolean;
  /** HTML chunks in stream order. */
  html?: string[];
  htmlComplete?: boolean;
  /** Helper functions that run once in the final sandbox. */
  jsFunctions?: string;
  jsFunctionsComplete?: boolean;
  /** Expressions that run one by one in the final sandbox. */
  jsExpressions?: string[];
  jsExpressionsComplete?: boolean;
};

/** The arguments of the `generateSandboxedUi` tool call. */
export type GenerateSandboxedUiArgs = {
  initialHeight?: number;
  /** Messages the tool call shows while the UI is generated. */
  placeholderMessages?: string[];
  css?: string;
  html?: string;
  jsFunctions?: string;
  jsExpressions?: string[];
};

/** `true` when the content has HTML that a preview or final sandbox shows. */
export function hasRenderableContent(
  content: OpenGenerativeUIContent | null | undefined,
): boolean {
  if (!content) return false;
  const hasHtml = !!content.html?.join("").trim();
  const hasFinalHtml = content.htmlComplete && hasHtml;
  const hasPreviewHtml =
    content.cssComplete && !content.htmlComplete && hasHtml;
  return !!hasFinalHtml || !!hasPreviewHtml;
}

/**
 * `true` when `next` must replace `previous` at once instead of waiting for
 * the throttle window: the UI restarts, a stage completes, or new JavaScript
 * arrives.
 */
export function shouldFlushImmediately(
  previous: OpenGenerativeUIContent | null | undefined,
  next: OpenGenerativeUIContent,
): boolean {
  // A new generation started — remove the old UI at once
  if (hasRenderableContent(previous) && !hasRenderableContent(next)) {
    return true;
  }
  // CSS finished — switch from placeholder to preview
  if (next.cssComplete && !previous?.cssComplete) return true;
  // Streaming done
  if (next.htmlComplete) return true;
  // Generation finished
  if (next.generating === false) return true;
  // jsFunctions appeared
  if (next.jsFunctions && !previous?.jsFunctions) return true;
  // jsExpressions grew
  if (
    (next.jsExpressions?.length ?? 0) > (previous?.jsExpressions?.length ?? 0)
  ) {
    return true;
  }
  // First html chunk arrived (first preview — no delay)
  if (next.html?.length && !previous?.html?.length) return true;
  return false;
}
