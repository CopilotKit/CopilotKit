import React from "react";
import { createContext, useContext, useEffect, ReactNode } from "react";
import { useLocalStorage } from "usehooks-ts";

type TailoredContentOption = string;

type TailoredContentContextType<T extends TailoredContentOption> = {
  mode: T;
  setMode: any;
};

const TailoredContentContext = createContext<
  TailoredContentContextType<TailoredContentOption> | undefined
>(undefined);

export const TailoredContentProvider = <T extends TailoredContentOption>({
  children,
}: {
  children: ReactNode;
}) => {
  const [mode, setMode] = useLocalStorage<T>(
    "copilotkit-tailored-content",
    "empty" as T
  );

  return (
    <TailoredContentContext.Provider value={{ mode, setMode }}>
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
    throw new Error(
      "useTailoredContent must be used within a TailoredContentProvider"
    );
  }

  useEffect(() => {
    if (!options.includes(context.mode as any)) {
      context.setMode(defaultOption);
    }
  }, [context.mode]);

  return context as TailoredContentContextType<T>;
};
