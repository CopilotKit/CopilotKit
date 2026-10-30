import { createContext } from "react";
import type { ɵToolCallDisplayContextValue } from "@copilotkit/core";

/**
 * Handed down by the message view so each message's tool calls and text can
 * follow the view's `toolCallDisplay` without every layer passing it along.
 * @internal
 */
export type ToolCallDisplayContextValue = ɵToolCallDisplayContextValue;

/** @internal */
export const ToolCallDisplayContext =
  createContext<ToolCallDisplayContextValue | null>(null);
