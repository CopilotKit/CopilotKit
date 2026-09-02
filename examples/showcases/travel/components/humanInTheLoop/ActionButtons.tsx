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
  const [error, setError] = useState<string | null>(null);
  const [failedResponse, setFailedResponse] = useState<{
    value: unknown;
  } | null>(null);

  useEffect(() => {
    console.log(tripPlaceIds, "placeIdsplaceIdsplaceIds");
  }, [tripPlaceIds]);

  useEffect(() => {
    console.log(selectedPlaceIdsByTrip, "btn");
  }, [selectedPlaceIdsByTrip]);

  const sendResponse = async (result: unknown) => {
    if (!respond) return;

    setError(null);
    setFailedResponse(null);
    await submitResponse({
      pending: pendingResponse,
      respond,
      result,
      onPendingChange: setIsPending,
      onError: (message, failedResult) => {
        setError(message);
        setFailedResponse({ value: failedResult });
      },
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
              const selections = (tripPlaceIds || []).map(
                ({ tripId, placeIds }) => {
                  const selectedPlaceIds = selectedPlaceIdsByTrip.get(tripId);
                  return {
                    tripId,
                    placeIds:
                      selectedPlaceIds && selectedPlaceIds.size > 0
                        ? Array.from(selectedPlaceIds)
                        : placeIds,
                  };
                },
              );
              if (
                selections.some(
                  ({ tripId }) => !selectedPlaceIdsByTrip.get(tripId)?.size,
                )
              ) {
                setSelectedPlaceIdsByTrip?.(
                  new Map(
                    selections.map(({ tripId, placeIds }) => [
                      tripId,
                      new Set(placeIds),
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
      {error && failedResponse && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 text-sm text-red-700 dark:text-red-300"
        >
          <span>{error}</span>
          <Button
            type="button"
            variant="link"
            size="sm"
            disabled={isPending}
            onClick={async () => sendResponse(failedResponse.value)}
          >
            Retry
          </Button>
        </div>
      )}
    </div>
  );
};
