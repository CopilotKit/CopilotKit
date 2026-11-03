import type { ReactNode } from "react";
import type { StreamingMarkdownNodeRendererKey } from "@copilotkit/markdown/react";

export const labels: Partial<Record<StreamingMarkdownNodeRendererKey, ReactNode>> = {
  link: <span>link</span>,
};
