import { RenderFunctionStatus } from "@copilotkit/react-core";
import { Button } from "../ui/button";

export type ActionButtonsProps = {
    status: RenderFunctionStatus;
    handler: any;
    approve: React.ReactNode;
    reject: React.ReactNode;
}

export const ActionButtons = ({ status, handler, approve, reject }: ActionButtonsProps) => (
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
      onClick={() => handler?.("SEND")}
    >
      {approve}
    </Button>
  </div>
);