"use client";

import React, { useState , ReactNode} from "react";
import { AnnotatedFunction } from "./useMakeCopilotWritable";

export interface CopilotContextParams {
  entryPoints: Record<string, AnnotatedFunction<any[]>>
  setEntryPoint: (id: string, entryPoint: AnnotatedFunction<any[]>) => void
  removeEntryPoint: (id: string) => void
}
export const CopilotContext = React.createContext<CopilotContextParams>({} as CopilotContextParams);


export function CopilotProvider({ children }: {
  children: ReactNode;
}): JSX.Element {
  const [entryPoints, setEntryPoints] = useState<Record<string, AnnotatedFunction<any[]>>>({});

  const setEntryPoint = (id: string, annotatedFunction: AnnotatedFunction<any[]>) => {
    setEntryPoints((prevPoints) => ({
      ...prevPoints,
      [id]: annotatedFunction,
    }));
  };

  const removeEntryPoint = (id: string) => {
    setEntryPoints((prevPoints) => {
      const newPoints = { ...prevPoints };
      delete newPoints[id];
      return newPoints;
    });
  };

  return (
    <CopilotContext.Provider value={{ entryPoints, setEntryPoint, removeEntryPoint }}>
      {children}
    </CopilotContext.Provider>
  );
}

