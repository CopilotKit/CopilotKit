import React, { createContext, useState, useContext, ReactNode } from "react";

interface HoveringEditorContextProps {
  isDisplayed: boolean;
  setIsDisplayed: (value: boolean) => void;
}

const HoveringEditorContext = createContext<HoveringEditorContextProps>({
  isDisplayed: false,
  setIsDisplayed: () => {},
});

interface HoveringEditorProviderProps {
  children: ReactNode;
}

export const HoveringEditorProvider = ({
  children,
}: HoveringEditorProviderProps) => {
  const [isDisplayed, setIsDisplayed] = useState(false);

  return (
    <HoveringEditorContext.Provider value={{ isDisplayed, setIsDisplayed }}>
      {children}
    </HoveringEditorContext.Provider>
  );
};

export const useHoveringEditorContext = () => useContext(HoveringEditorContext);
