import { ToolCallStatus } from "@copilotkit/react-core/v2";
import { Button } from "../ui/button";
import { useEffect } from "react";

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
  useEffect(() => {
    console.log(placeIds, "placeIdsplaceIdsplaceIds");
  }, [placeIds]);

  useEffect(() => {
    console.log(selectedPlaceIds, "btn");
  }, [selectedPlaceIds]);

  return (
    <div className="flex gap-4 justify-between">
      <Button
        className="w-full"
        variant="outline"
        disabled={status !== ToolCallStatus.Executing}
        onClick={async () => respond?.("CANCEL")}
      >
        {reject}
      </Button>
      <Button
        className="w-full"
        disabled={status !== ToolCallStatus.Executing}
        onClick={async () => {
          if (selectedPlaceIds && selectedPlaceIds.size > 0) {
            if (type == "edit") {
              console.log(Array.from(selectedPlaceIds), "selectedPlaceIds");
              await respond?.(
                JSON.stringify(Array.from(selectedPlaceIds) + "|||editMode"),
              );
            } else {
              console.log(Array.from(selectedPlaceIds), "selectedPlaceIds");
              await respond?.(
                JSON.stringify(Array.from(selectedPlaceIds) + "|||addMode"),
              );
            }
          } else if (selectedPlaceIds && selectedPlaceIds.size == 0) {
            setSelectedPlaceIds?.(new Set(placeIds?.[0] || []));
            if (type == "edit") {
              // console.log(Array.from(selectedPlaceIds), "selectedPlaceIds")
              await respond?.(JSON.stringify(placeIds?.[0] + "|||editMode"));
            } else {
              // console.log(Array.from(selectedPlaceIds), "selectedPlaceIds")
              await respond?.(JSON.stringify(placeIds?.[0] + "|||addMode"));
            }
          } else {
            await respond?.("SEND");
          }
        }}
      >
        {approve}
      </Button>
    </div>
  );
};
