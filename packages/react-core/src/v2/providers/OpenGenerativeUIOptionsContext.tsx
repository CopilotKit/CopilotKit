import React, { createContext, useContext } from "react";
import { OPEN_GEN_UI_DESIGN_SYSTEM_CSS } from "../lib/designSystemCss";
import { DEFAULT_OPEN_GEN_UI_LIBRARIES } from "../lib/assembleDocument";

export interface OpenGenerativeUIResolvedOptions {
  /** CSS kit to inject, or false when disabled. */
  designSystemCss: string | false;
  /** Importmap entries to inject, or false when disabled. */
  importMap: Record<string, string> | false;
}

export const DEFAULT_OPEN_GEN_UI_OPTIONS: OpenGenerativeUIResolvedOptions = {
  designSystemCss: OPEN_GEN_UI_DESIGN_SYSTEM_CSS,
  importMap: DEFAULT_OPEN_GEN_UI_LIBRARIES,
};

const OpenGenerativeUIOptionsContext =
  createContext<OpenGenerativeUIResolvedOptions>(DEFAULT_OPEN_GEN_UI_OPTIONS);

export const OpenGenerativeUIOptionsProvider =
  OpenGenerativeUIOptionsContext.Provider;

export function useOpenGenerativeUIOptions(): OpenGenerativeUIResolvedOptions {
  return useContext(OpenGenerativeUIOptionsContext);
}
