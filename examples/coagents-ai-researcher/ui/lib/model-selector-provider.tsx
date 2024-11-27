"use client";

import React from "react";
import { createContext, useContext, useState, ReactNode } from "react";

type ModelSelectorContextType = {
  model: string;
  setModel: (model: string) => void;
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
  useLgc: boolean;
};

const ModelSelectorContext = createContext<
  ModelSelectorContextType | undefined
>(undefined);

export const ModelSelectorProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const model =
    globalThis.window === undefined
      ? "openai"
      : new URL(window.location.href).searchParams.get("coAgentsModel") ??
        "openai";
  const [hidden, setHidden] = useState<boolean>(false);

  const setModel = (model: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("coAgentsModel", model);
    window.location.href = url.toString();
  };

  const useLgc = globalThis.window === undefined
      ? false
      : !!(new URL(window.location.href).searchParams.get("lgc"))

  return (
    <ModelSelectorContext.Provider
      value={{
        model,
        hidden,
        useLgc,
        setModel,
        setHidden,
      }}
    >
      {children}
    </ModelSelectorContext.Provider>
  );
};

export const useModelSelectorContext = () => {
  const context = useContext(ModelSelectorContext);
  if (context === undefined) {
    throw new Error(
      "useModelSelectorContext must be used within a ModelSelectorProvider"
    );
  }
  return context;
};
