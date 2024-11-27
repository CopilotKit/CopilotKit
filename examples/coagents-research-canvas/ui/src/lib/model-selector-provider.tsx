"use client";

import React from "react";
import { createContext, useContext, useState, ReactNode } from "react";

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

  const agent =
    model === "google_genai" ? "research_agent_google_genai" : "research_agent";

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
      "useModelSelectorContext must be used within a ModelSelectorProvider"
    );
  }
  return context;
};
