import { createContext, useState, useContext, ReactNode } from "react";

interface HoveringEditorContextProps {
  isDisplayed: boolean;
  setIsDisplayed: (value: boolean) => void;
}

const HoveringEditorContext = createContext<HoveringEditorContextProps>({
  isDisplayed: false,
  setIsDisplayed: () => {},
});

export interface HoveringEditorProviderProps {
  children: ReactNode;
}

/**
 * A context provider for the hovering editor over the `CopilotTextarea`
 * (used to edit and insert text into the `CopilotTextarea`).
 */
export const HoveringEditorProvider = ({ children }: HoveringEditorProviderProps) => {
  const [isDisplayed, setIsDisplayed] = useState<boolean>(false);

  return (
    <HoveringEditorContext.Provider value={{ isDisplayed, setIsDisplayed }}>
      {children}
    </HoveringEditorContext.Provider>
  );
};

export const useHoveringEditorContext = () => useContext(HoveringEditorContext);
