import { ToolCallStatus } from "@copilotkit/react-core/v2";
import { Button } from "../ui/button";
import { useEffect, useRef, useState } from "react";
import { submitResponse } from "./response-submission";

export type ActionButtonsProps = {
  status: ToolCallStatus;
  respond?: (result: unknown) => Promise<void>;
  approve: React.ReactNode;
  reject: React.ReactNode;
  selectedPlaceIds?: Set<string>;
  type?: "edit" | "add";
  placeIds?: string[][];
  setSelectedPlaceIds?: (placeIds: Set<string>) => void;
};

export const ActionButtons = ({
  status,
  respond,
  approve,
  reject,
  selectedPlaceIds,
  type = "add",
  placeIds,
  setSelectedPlaceIds,
}: ActionButtonsProps) => {
  const pendingResponse = useRef(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedResponse, setFailedResponse] = useState<{
    value: unknown;
  } | null>(null);

  useEffect(() => {
    console.log(placeIds, "placeIdsplaceIdsplaceIds");
  }, [placeIds]);

  useEffect(() => {
    console.log(selectedPlaceIds, "btn");
  }, [selectedPlaceIds]);

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
            if (selectedPlaceIds && selectedPlaceIds.size > 0) {
              if (type == "edit") {
                console.log(Array.from(selectedPlaceIds), "selectedPlaceIds");
                await sendResponse(
                  JSON.stringify({
                    operation: "replace",
                    placeIds: Array.from(selectedPlaceIds),
                  }),
                );
              } else {
                console.log(Array.from(selectedPlaceIds), "selectedPlaceIds");
                await sendResponse(
                  JSON.stringify(Array.from(selectedPlaceIds) + "|||addMode"),
                );
              }
            } else if (selectedPlaceIds && selectedPlaceIds.size == 0) {
              setSelectedPlaceIds?.(new Set(placeIds?.[0] || []));
              if (type == "edit") {
                // console.log(Array.from(selectedPlaceIds), "selectedPlaceIds")
                await sendResponse(
                  JSON.stringify({
                    operation: "replace",
                    placeIds: placeIds?.[0] || [],
                  }),
                );
              } else {
                // console.log(Array.from(selectedPlaceIds), "selectedPlaceIds")
                await sendResponse(
                  JSON.stringify(placeIds?.[0] + "|||addMode"),
                );
              }
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
