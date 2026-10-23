import { ShowCar, ShowCars } from "@/components/generative-ui/show-car";
import { cars } from "@/lib/types";
import type { Car } from "@/lib/types";
import { useGlobalState } from "@/lib/stages";
import { useAgentContext, useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { z } from "zod";

const carSchema = z.object({
  id: z.number().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().optional(),
  color: z.string().optional(),
  price: z.number().optional(),
  image: z
    .object({
      src: z.string(),
      alt: z.string(),
      author: z.string(),
    })
    .optional(),
});

/**
  useStageBuildCar is a hook that will add this stage to the state machine. It is responsible for:
  - Helping the user select a car.
  - Storing the selected car in the global state.
  - Moving to the next stage, sellFinancing.
*/
export function useStageBuildCar() {
  const { setSelectedCar, stage, setStage } = useGlobalState();

  // Conditionally add additional readable information for the agent's prompt.
  useAgentContext({
    description: "Car inventory available while the user selects a car",
    value: stage === "buildCar" ? cars : [],
  });

  // Conditionally add an action to show a single car.
  useHumanInTheLoop(
    {
      name: "showCar",
      description:
        "Show a single car that you have in mind. Do not call this more than once, call `showMultipleCars` if you have multiple cars to show.",
      available: stage === "buildCar",
      parameters: z.object({
        car: carSchema.describe("The car to show"),
      }),
      render: ({ args, status, respond }) => {
        const { car } = args;
        return (
          <ShowCar
            car={car ?? {}}
            status={status}
            onSelect={async () => {
              if (!respond) return;

              // Store the selected car in the global state.
              setSelectedCar(car ?? {});

              // Move to the next stage, sellFinancing.
              setStage("sellFinancing");

              // Let the agent know that the user has selected a car.
              await respond(
                "User has selected a car you can see it in your context, the system will now move to the next state, do not call nextState.",
              );
            }}
            onReject={async () => {
              if (!respond) return;
              await respond(
                "User wants to select a different car, please stay in this state and help them select a different car",
              );
            }}
          />
        );
      },
    },
    [stage],
  );

  // Conditionally add an action to show multiple cars.
  useHumanInTheLoop(
    {
      name: "showMultipleCars",
      description:
        "Show a list of cars based on the user's query. Do not call this more than once. Call `showCar` if you only have a single car to show.",
      available: stage === "buildCar",
      parameters: z.object({
        cars: z.array(carSchema).describe("The cars to show"),
      }),
      render: ({ args, status, respond }) => {
        return (
          <ShowCars
            cars={(args.cars ?? []) as Car[]}
            status={status}
            onSelect={async (car) => {
              if (!respond) return;

              // Store the selected car in the global state.
              setSelectedCar(car);

              // Move to the next stage, sellFinancing.
              setStage("sellFinancing");

              // Let the agent know that the user has selected a car.
              await respond(
                "User has selected a car you can see it in your context, you are now moving to the next state",
              );
            }}
          />
        );
      },
    },
    [stage],
  );
}
