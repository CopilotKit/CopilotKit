import { cn } from "@/lib/utils";
import { CheckIcon, LoaderCircle } from "lucide-react";
import { truncateUrl } from "@/lib/utils";

export function Progress({
  logs,
}: {
  logs: {
    message: string;
    done: boolean;
  }[];
}) {
  if (logs.length === 0) {
    return null;
  }

  return (
    <div data-test-id="progress-steps">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100/30 py-2 text-sm shadow-md">
        {logs.map((log, index) => (
          <div
            key={index}
            data-test-id="progress-step-item"
            className={`flex ${
              log.done || index === logs.findIndex((log) => !log.done)
                ? ""
                : "opacity-50"
            }`}
          >
            <div className="w-8">
              <div
                className="ml-[12px] mt-[10px] flex h-4 w-4 items-center justify-center rounded-full bg-slate-700"
                data-test-id={
                  log.done
                    ? "progress-step-item_done"
                    : "progress-step-item_loading"
                }
              >
                {log.done ? (
                  <CheckIcon className="h-3 w-3 text-white" />
                ) : (
                  <LoaderCircle className="h-3 w-3 animate-spin text-white" />
                )}
              </div>
              {index < logs.length - 1 && (
                <div
                  className={cn("h-full w-[1px] bg-slate-200 ml-[20px]")}
                ></div>
              )}
            </div>
            <div className="flex flex-1 justify-center py-2 pl-2 pr-4">
              <div className="flex flex-1 items-center text-xs">
                {log.message.replace(
                  /https?:\/\/[^\s]+/g, // Regex to match URLs
                  (url) => truncateUrl(url), // Replace with truncated URL
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
