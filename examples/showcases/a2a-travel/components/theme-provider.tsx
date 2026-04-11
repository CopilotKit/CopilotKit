"use client";

import * as React from "react";
import type {
  ThemeProviderProps as NextThemeProviderProps} from "next-themes";
import {
  ThemeProvider as NextThemesProvider
} from "next-themes";

export function ThemeProvider({ children, ...props }: NextThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
