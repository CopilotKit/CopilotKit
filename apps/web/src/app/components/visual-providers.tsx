"use client";

import * as React from "react";
import { ThemeProviderProps } from "next-themes/dist/types";

import { TooltipProvider } from "@copilotkit/react-ui";
import { ThemeProvider } from "next-themes";

export function VisualProviders({ children, ...props }: ThemeProviderProps) {
  return (
    <ThemeProvider {...props}>
      <TooltipProvider>{children}</TooltipProvider>
    </ThemeProvider>
  );
}
