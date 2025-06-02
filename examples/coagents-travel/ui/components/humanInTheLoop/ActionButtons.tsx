import { RenderFunctionStatus } from "@copilotkit/react-core";
import { Button } from "../ui/button";
import { useEffect } from "react";

export type ActionButtonsProps = {
  status: RenderFunctionStatus;
  handler: any;
  approve: React.ReactNode;
  reject: React.ReactNode;
  selectedPlaceIds?: Set<string>;
}

export const ActionButtons = ({ status, handler, approve, reject, selectedPlaceIds }: ActionButtonsProps) => {
  
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
          if (selectedPlaceIds) {
            debugger
            handler?.(Array.from(selectedPlaceIds));
          } else {
            handler?.("SEND");
          }
        }}
      >
        {approve}
      </Button>
    </div>
  );
};