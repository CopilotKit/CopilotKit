import type Websandbox from "@jetbrains/websandbox";
import {
  OpenGenerativeUIContentSchema,
  type OpenGenerativeUIContent,
} from "../../open-generative-ui";

export type WebsandboxConstructor = typeof Websandbox;
export type WebsandboxInstance = InstanceType<WebsandboxConstructor>;

export type WebsandboxModuleShape = {
  default:
    | WebsandboxConstructor
    | {
        default: WebsandboxConstructor;
      };
};

export function resolveWebsandboxConstructor(
  module: WebsandboxModuleShape,
): WebsandboxConstructor {
  const defaultExport = module.default;
  return "default" in defaultExport ? defaultExport.default : defaultExport;
}

export function hasRenderableOpenGenerativeUIContent(
  content: OpenGenerativeUIContent | undefined,
): boolean {
  if (!content) return false;
  const hasHtml = !!content.html?.join("").trim();
  const hasFinalHtml = content.htmlComplete && hasHtml;
  const hasPreviewHtml =
    content.cssComplete && !content.htmlComplete && hasHtml;
  return !!hasFinalHtml || !!hasPreviewHtml;
}

export function shouldFlushOpenGenerativeUIImmediately(
  previous: OpenGenerativeUIContent | undefined,
  next: OpenGenerativeUIContent,
): boolean {
  if (
    hasRenderableOpenGenerativeUIContent(previous) &&
    !hasRenderableOpenGenerativeUIContent(next)
  ) {
    return true;
  }
  if (next.cssComplete && !previous?.cssComplete) return true;
  if (next.htmlComplete) return true;
  if (next.generating === false) return true;
  if (next.jsFunctions && !previous?.jsFunctions) return true;
  if (
    (next.jsExpressions?.length ?? 0) > (previous?.jsExpressions?.length ?? 0)
  ) {
    return true;
  }
  if (next.html?.length && !previous?.html?.length) return true;
  return false;
}

export function parseOpenGenerativeUIContent(
  content: unknown,
): OpenGenerativeUIContent {
  const parsed = OpenGenerativeUIContentSchema.safeParse(content);
  return parsed.success ? parsed.data : {};
}
