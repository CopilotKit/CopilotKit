import { RenderFunctionStatus } from "@copilotkit/react-core";
import { Button } from "../ui/button";
import { useEffect } from "react";

export type ActionButtonsProps = {
  status: RenderFunctionStatus;
  handler: any;
  approve: React.ReactNode;
  reject: React.ReactNode;
  selectedPlaceIds?: Set<string>;
  type?: "edit" | "add";
  placeIds?: string[][];
  setSelectedPlaceIds?: (placeIds: Set<string>) => void;
}

export const ActionButtons = ({ status, handler, approve, reject, selectedPlaceIds, type="add", placeIds, setSelectedPlaceIds }: ActionButtonsProps) => {
  useEffect(() => {
    console.log(placeIds, "placeIdsplaceIdsplaceIds");
  }, [placeIds]);
  
  useEffect(() => {
    console.log(selectedPlaceIds,"btn");
  }, [selectedPlaceIds]);
  
  return (
    <div className="flex gap-4 justify-between">
      <Button
        className="w-full"
        variant="outline"
        disabled={status === "complete" || status === "inProgress"}
        onClick={() => handler?.("CANCEL")}
      >
        {reject}
      </Button>
      <Button
        className="w-full"
        disabled={status === "complete" || status === "inProgress"}
        onClick={() => {
          debugger;
          if (selectedPlaceIds && selectedPlaceIds.size > 0) {
            if(type == "edit"){
              console.log(Array.from(selectedPlaceIds), "selectedPlaceIds")
              handler?.(JSON.stringify(Array.from(selectedPlaceIds)+"|||editMode"));
            } else {
              console.log(Array.from(selectedPlaceIds), "selectedPlaceIds")
              handler?.(JSON.stringify(Array.from(selectedPlaceIds)+"|||addMode"));
            }
          } 
          else if(selectedPlaceIds && selectedPlaceIds.size == 0){
            setSelectedPlaceIds?.(new Set(placeIds?.[0] || []));
            if(type == "edit"){
              // console.log(Array.from(selectedPlaceIds), "selectedPlaceIds")
              handler?.(JSON.stringify(placeIds?.[0]+"|||editMode"));
            } else {
              // console.log(Array.from(selectedPlaceIds), "selectedPlaceIds")
              handler?.(JSON.stringify(placeIds?.[0]+"|||addMode"));
            }
          }
          else {
            handler?.("SEND");
          }
        }
      }
      >
        {approve}
      </Button>
    </div>
  );
};