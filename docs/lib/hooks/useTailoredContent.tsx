import { createContext, useContext, useState, ReactNode } from "react";
import { useLocalStorage } from "usehooks-ts";

type TailoredContentOption = string;

type TailoredContentContextType<T extends TailoredContentOption> = {
  mode: T;
  setMode: (mode: T) => void;
};

const TailoredContentContext = createContext<TailoredContentContextType<TailoredContentOption> | undefined>(undefined);

export const TailoredContentProvider = <T extends TailoredContentOption>({ 
  children, 
  options, 
  defaultOption 
}: { 
  children: ReactNode; 
  options: T[]; 
  defaultOption: T;
}) => {
  const [mode, setMode] = useLocalStorage<T>("copilotkit-tailored-content", defaultOption);

  return (
    <TailoredContentContext.Provider
      value={{ mode, setMode }}
    >
      {children}
    </TailoredContentContext.Provider>
  );
};

export const useTailoredContent = <T extends TailoredContentOption>(
  options: T[],
  defaultOption: T
): TailoredContentContextType<T> => {
  const context = useContext(TailoredContentContext);
  if (context === undefined) {
    throw new Error("useTailoredContent must be used within a TailoredContentProvider");
  }
  return context as TailoredContentContextType<T>;
};
