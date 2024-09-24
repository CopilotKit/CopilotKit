import { cn } from "@/lib/utils";
import { CheckIcon, LoaderCircle } from "lucide-react";

export function Progress({
  steps,
}: {
  steps: {
    description: string;
    status: "complete" | "done";
    updates: string[];
  }[];
}) {
  if (steps.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="border border-slate-200 bg-slate-100/30 shadow-md rounded-lg overflow-hidden text-sm py-2">
        {steps.map((step, index) => (
          <div key={index} className="flex">
            <div className="w-8">
              <div className="w-4 h-4 bg-slate-700 flex items-center justify-center rounded-full mt-[10px] ml-[12px]">
                {step.status === "complete" ? (
                  <CheckIcon className="w-3 h-3 text-white" />
                ) : (
                  <LoaderCircle className="w-3 h-3 text-white animate-spin" />
                )}
              </div>
              {index < steps.length - 1 && (
                <div
                  className={cn("h-full w-[1px] bg-slate-200 ml-[20px]")}
                ></div>
              )}
            </div>
            <div className="flex-1 flex justify-center py-2 pl-2 pr-4">
              <div className="flex-1 flex items-center">{step.description}</div>
              <div className="text-slate-400">
                {step.updates?.length > 0 && step.updates[step.updates.length - 1]}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
