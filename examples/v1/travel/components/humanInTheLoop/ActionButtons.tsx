import { ToolCallStatus } from "@copilotkit/react-core/v2";
import { Button } from "../ui/button";
import { useEffect, useRef, useState } from "react";
import { submitResponse } from "./response-submission";

export type PlaceSelectionsByTrip = Map<string, Set<string>>;

type TripPlaceIds = {
  tripId: string;
  placeIds: string[];
};

export type ActionButtonsProps = {
  status: ToolCallStatus;
  respond?: (result: unknown) => Promise<void>;
  approve: React.ReactNode;
  reject: React.ReactNode;
  selectedPlaceIdsByTrip?: PlaceSelectionsByTrip;
  type?: "edit" | "add";
  tripPlaceIds?: TripPlaceIds[];
  setSelectedPlaceIdsByTrip?: (selections: PlaceSelectionsByTrip) => void;
};

export const ActionButtons = ({
  status,
  respond,
  approve,
  reject,
  selectedPlaceIdsByTrip,
  type = "add",
  tripPlaceIds,
  setSelectedPlaceIdsByTrip,
}: ActionButtonsProps) => {
  const pendingResponse = useRef(false);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    console.log(tripPlaceIds, "placeIdsplaceIdsplaceIds");
  }, [tripPlaceIds]);

  useEffect(() => {
    console.log(selectedPlaceIdsByTrip, "btn");
  }, [selectedPlaceIdsByTrip]);

  const sendResponse = async (result: unknown) => {
    if (!respond) return;

    await submitResponse({
      pending: pendingResponse,
      respond,
      result,
      onPendingChange: setIsPending,
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-4 justify-between">
        <Button
          className="w-full"
          variant="outline"
          disabled={status !== ToolCallStatus.Executing || isPending}
          onClick={async () => sendResponse("CANCEL")}
        >
          {reject}
        </Button>
        <Button
          className="w-full"
          disabled={status !== ToolCallStatus.Executing || isPending}
          onClick={async () => {
            if (selectedPlaceIdsByTrip) {
              const selections = (tripPlaceIds || []).map(({ tripId }) => {
                const selectedPlaceIds = selectedPlaceIdsByTrip.get(tripId);
                if (!selectedPlaceIdsByTrip.has(tripId)) {
                  return { tripId };
                }
                return {
                  tripId,
                  placeIds: Array.from(selectedPlaceIds || []),
                };
              });
              if (selections.some((selection) => !("placeIds" in selection))) {
                setSelectedPlaceIdsByTrip?.(
                  new Map(
                    (tripPlaceIds || []).map(({ tripId, placeIds }) => [
                      tripId,
                      selectedPlaceIdsByTrip.has(tripId)
                        ? new Set(selectedPlaceIdsByTrip.get(tripId))
                        : new Set(placeIds),
                    ]),
                  ),
                );
              }
              await sendResponse(
                JSON.stringify({
                  operation: type === "edit" ? "replace" : "select",
                  selections,
                }),
              );
            } else {
              await sendResponse("SEND");
            }
          }}
        >
          {approve}
        </Button>
      </div>
    </div>
  );
};
