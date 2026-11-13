import { useGlobalState } from "@/lib/stages";
import { useAgentContext, useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";

export interface UseStagePaymentMethodOptions {
  enabled: boolean;
  onNextState: () => void;
}

/**
  useStateSellFinancing is a hook that will add this stage to the state machine. It is responsible for:
  - Selling the financing option to the user.
  - Choosing the next stage, getFinancingInfo or getPaymentInfo, based on the user's response.
*/
export function useStageSellFinancing() {
  const { stage, setStage } = useGlobalState();

  // Conditionally add additional readable information for the agent's prompt.
  useAgentContext({
    description: "Financing promotion available during financing selection",
    value:
      stage === "sellFinancing"
        ? "Current promotion: 0% financing for 60 months. After 60 months, the interest rate will be 10%."
        : null,
  });

  // Conditionally add an action to move to the getFinancingInfo stage.
  useFrontendTool(
    {
      name: "selectFinancing",
      description: "Select the financing option",
      available: stage === "sellFinancing",
      parameters: z.object({}),
      handler: async () => {
        setStage("getFinancingInfo");
        return "Financing selected";
      },
    },
    [stage],
  );

  // Conditionally add an action to move to the getPaymentInfo stage.
  useFrontendTool(
    {
      name: "selectNoFinancing",
      description: "Select the no financing option",
      available: stage === "sellFinancing",
      parameters: z.object({}),
      handler: async () => {
        setStage("getPaymentInfo");
        return "Financing declined";
      },
    },
    [stage],
  );
}
