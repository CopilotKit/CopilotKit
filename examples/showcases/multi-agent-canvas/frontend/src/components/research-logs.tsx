import { FC } from "react";
type ResearchLog = {
  message: string;
  done: boolean;
};

type ResearchLogsProps = {
  logs: ResearchLog[];
};

export const ResearchLogs: FC<ResearchLogsProps> = ({ logs }) => (
  <div className="mt-4 bg-gray-100 p-4 rounded-md">
    <section aria-labelledby="research-logs-title">
      <ol className="relative border-l border-gray-200 ml-3">
        {logs?.map((log, index) => (
          <li key={index} className="mb-6 ml-4">
            <div className="absolute w-3 h-3 bg-gray-200 rounded-full -left-1.5 border border-white">
              {log.done && (
                <div className="w-2 h-2 bg-green-500 rounded-full absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
              )}
            </div>
            <p className="text-sm font-normal text-gray-700">{log.message}</p>
          </li>
        ))}
      </ol>
    </section>
  </div>
);
