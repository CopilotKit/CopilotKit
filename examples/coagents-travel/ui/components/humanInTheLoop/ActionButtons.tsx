import { RenderFunctionStatus } from "@copilotkit/react-core";
import { Button } from "../ui/button";
import { useEffect } from "react";

export type ActionButtonsProps = {
  status: RenderFunctionStatus;
  respond: any;
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
  return (
    <div className="flex gap-4 justify-between">
      <Button
        className="w-full"
        variant="outline"
        disabled={status === "complete" || status === "inProgress"}
        onClick={() => respond?.("CANCEL")}
      >
        {reject}
      </Button>
      <Button
        className="w-full"
        disabled={status === "complete" || status === "inProgress"}
        onClick={() => {
          debugger;
          if (selectedPlaceIds && selectedPlaceIds.size > 0) {
            if (type == "edit") {
              console.log(Array.from(selectedPlaceIds), "selectedPlaceIds");
              respond?.(
                JSON.stringify(Array.from(selectedPlaceIds) + "|||editMode")
              );
            } else {
              console.log(Array.from(selectedPlaceIds), "selectedPlaceIds");
              respond?.(
                JSON.stringify(Array.from(selectedPlaceIds) + "|||addMode")
              );
            }
          } else if (selectedPlaceIds && selectedPlaceIds.size == 0) {
            setSelectedPlaceIds?.(new Set(placeIds?.[0] || []));
            if (type == "edit") {
              // console.log(Array.from(selectedPlaceIds), "selectedPlaceIds")
              respond?.(JSON.stringify(placeIds?.[0] + "|||editMode"));
            } else {
              // console.log(Array.from(selectedPlaceIds), "selectedPlaceIds")
              respond?.(JSON.stringify(placeIds?.[0] + "|||addMode"));
            }
          } else {
            respond?.("SEND");
          }
        }}
      >
        {approve}
      </Button>
    </div>
  );
};
