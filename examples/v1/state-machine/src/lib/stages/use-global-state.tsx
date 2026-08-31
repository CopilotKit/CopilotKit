import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { defaultOrders } from "@/lib/types";
import type {
  Car,
  ContactInfo,
  CardInfo,
  Order,
  FinancingInfo,
} from "@/lib/types";
import { stageInstructions } from "@/lib/system-prompt";
import type { Stage } from "@/lib/system-prompt";

import { useAgentContext } from "@copilotkit/react-core/v2";

export type { Stage } from "@/lib/system-prompt";

interface GlobalState {
  stage: Stage;
  setStage: React.Dispatch<React.SetStateAction<Stage>>;
  selectedCar: Car | null;
  setSelectedCar: React.Dispatch<React.SetStateAction<Car | null>>;
  contactInfo: ContactInfo | null;
  setContactInfo: React.Dispatch<React.SetStateAction<ContactInfo | null>>;
  cardInfo: CardInfo | null;
  setCardInfo: React.Dispatch<React.SetStateAction<CardInfo | null>>;
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  financingInfo: FinancingInfo | null;
  setFinancingInfo: React.Dispatch<React.SetStateAction<FinancingInfo | null>>;
}

export const GlobalStateContext = createContext<GlobalState | null>(null);

/**
  useGlobalState is a hook that will return the global state of the application. It must
  be used within a GlobalStateProvider. It keeps track of the:
  - Current stage of the application.
  - Selected car.
  - Contact information of the user.
  - Card information of the user.
  - Orders of the user.
  - Financing information of the user.
*/
export function useGlobalState() {
  const context = useContext(GlobalStateContext);
  if (!context) {
    throw new Error("useGlobalState must be used within a GlobalStateProvider");
  }
  return context;
}

export function GlobalStateProvider({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<Stage>("getContactInfo");
  const [selectedCar, setSelectedCar] = useState<Car | null>(null);
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null);
  const [cardInfo, setCardInfo] = useState<CardInfo | null>(null);
  const [orders, setOrders] = useState<Order[]>(defaultOrders);
  const [financingInfo, setFinancingInfo] = useState<FinancingInfo | null>(
    null,
  );

  useAgentContext({
    description: "Currently Specified Information",
    value: {
      contactInfo,
      selectedCar,
      cardInfo,
      financingInfo,
      orders,
      currentStage: stage,
    },
  });

  useAgentContext({
    description:
      "Instructions for the current stage. Follow these instructions before responding.",
    value: {
      currentStage: stage,
      instructions: stageInstructions[stage],
    },
  });

  return (
    <GlobalStateContext.Provider
      value={{
        stage,
        setStage,
        selectedCar,
        setSelectedCar,
        contactInfo,
        setContactInfo,
        cardInfo,
        setCardInfo,
        orders,
        setOrders,
        financingInfo,
        setFinancingInfo,
      }}
    >
      {children}
    </GlobalStateContext.Provider>
  );
}
