"use client";

import React from "react";
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { normalizeModel } from "./model-selector";

type ModelSelectorContextType = {
  model: string;
  setModel: (model: string) => void;
  agent: string;
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
};

const ModelSelectorContext = createContext<
  ModelSelectorContextType | undefined
>(undefined);

const setModel = (selectedModel: string) => {
  const url = new URL(window.location.href);
  url.searchParams.set("coAgentsModel", selectedModel);
  window.location.href = url.toString();
};

export const ModelSelectorProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const model = normalizeModel(
    globalThis.window === undefined
      ? null
      : new URL(window.location.href).searchParams.get("coAgentsModel"),
  );
  const [hidden, setHidden] = useState<boolean>(false);

  let agent = "research_agent";
  if (model === "google_genai") {
    agent = "research_agent_google_genai";
  }

  return (
    <ModelSelectorContext.Provider
      value={{
        model,
        agent,
        hidden,
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
      "useModelSelectorContext must be used within a ModelSelectorProvider",
    );
  }
  return context;
};
