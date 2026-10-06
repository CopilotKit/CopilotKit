import type { StandardSchemaV1 } from "@copilotkit/shared";
import type { FrontendToolHandlerContext } from "@copilotkit/core";
import { z } from "zod";

export const OPEN_GENERATIVE_UI_ACTIVITY_TYPE = "open-generative-ui";
export const GENERATE_SANDBOXED_UI_TOOL_NAME = "generateSandboxedUi";

export const DEFAULT_OPEN_GENERATIVE_UI_DESIGN_SKILL = `When generating UI with generateSandboxedUi, follow these design principles inspired by shadcn/ui:

- Use a minimal, flat aesthetic. Avoid drop shadows and gradients — rely on subtle borders (1px solid, light gray like #e5e7eb) to define surfaces.
- Neutral base palette: white backgrounds, zinc/slate gray text (#09090b for headings, #71717a for secondary text). One accent color for interactive elements.
- Use system font stacks (system-ui, -apple-system, sans-serif) at readable sizes (14px body, 600 weight for headings). Tight line-heights.
- Small, consistent border-radius (6–8px). Cards and containers use border, not shadow, for separation.
- Buttons: solid fill for primary (dark bg, white text), outline for secondary (border + transparent bg). Subtle hover state (slight opacity or background shift).
- Use CSS Grid or Flexbox for layout. Ensure the UI looks good at any width.
- Minimal transitions (150ms) for hover/focus states only. No decorative animations.
- Keep the UI focused and dense — avoid excessive padding. Use compact spacing (8–12px gaps, 10–14px padding in controls).`;

export { GENERATE_SANDBOXED_UI_DESCRIPTION } from "@copilotkit/shared";

export const OpenGenerativeUIContentSchema = z.object({
  initialHeight: z.number().optional(),
  generating: z.boolean().optional(),
  css: z.string().optional(),
  cssComplete: z.boolean().optional(),
  html: z.array(z.string()).optional(),
  htmlComplete: z.boolean().optional(),
  jsFunctions: z.string().optional(),
  jsFunctionsComplete: z.boolean().optional(),
  jsExpressions: z.array(z.string()).optional(),
  jsExpressionsComplete: z.boolean().optional(),
});

export type OpenGenerativeUIContent = z.infer<
  typeof OpenGenerativeUIContentSchema
>;

export const GenerateSandboxedUiArgsSchema = z.object({
  initialHeight: z.number().optional(),
  placeholderMessages: z.array(z.string()).optional(),
  css: z.string().optional(),
  html: z.string().optional(),
  jsFunctions: z.string().optional(),
  jsExpressions: z.array(z.string()).optional(),
});

export type GenerateSandboxedUiArgs = z.infer<
  typeof GenerateSandboxedUiArgsSchema
>;

export type SandboxFunction<
  Args extends Record<string, unknown> = Record<string, unknown>,
> = {
  name: string;
  description: string;
  parameters: StandardSchemaV1<unknown, Args>;
  handler: (
    args: Args,
    context?: FrontendToolHandlerContext,
  ) => Promise<unknown> | unknown;
};

export interface OpenGenerativeUIConfig {
  sandboxFunctions?: SandboxFunction[];
  designSkill?: string;
}
