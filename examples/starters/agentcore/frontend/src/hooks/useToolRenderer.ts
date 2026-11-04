import type { ReactNode } from "react";
import type { ToolCallStatus } from "@/components/chat/types";

export interface ToolRenderProps {
  name: string;
  args: string;
  status: ToolCallStatus;
  result?: string;
}

export type ToolRenderFn = (props: ToolRenderProps) => ReactNode;

const renderers = new Map<string, ToolRenderFn>();

export function useDefaultTool(render: ToolRenderFn) {
  renderers.set("*", render);
}

export function useToolRenderer(name: string, render: ToolRenderFn) {
  renderers.set(name, render);
}

export function getToolRenderer(name: string): ToolRenderFn | null {
  return renderers.get(name) ?? renderers.get("*") ?? null;
}
