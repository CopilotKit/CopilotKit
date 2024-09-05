import { createContext, useContext, useState, ReactNode } from "react";
import { useLocalStorage } from "usehooks-ts";

type TailordContextContextType = {
  mode: "cloud" | "self-host";
  setMode: (mode: "cloud" | "self-host") => void;
};

const TailoredContentContext = createContext<TailordContextContextType | undefined>(undefined);

export const TailoredContentProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useLocalStorage<"cloud" | "self-host">("copilotkit-cloud-or-self-hosting", "cloud");

  return (
    <TailoredContentContext.Provider
      value={{ mode, setMode }}
    >
      {children}
    </TailoredContentContext.Provider>
  );
};

export const useTailoredContent = () => {
  const context = useContext(TailoredContentContext);
  if (context === undefined) {
    throw new Error("useTailoredContent must be used within a TailoredContentProvider");
  }
  return context;
};
