import { LangGraphInterruptEvent } from "@copilotkit/runtime-client-gql";
import { useState } from "react";

export interface InterruptProps {
    event: LangGraphInterruptEvent;
    result: unknown;
    resolve: (resolution: string) => void;
}

export function Interrupt({ event, resolve }: InterruptProps) {
  const [response, setResponse] = useState("");

  const wrapperStyles = "flex flex-col justify-center items-center h-full w-full bg-indigo-600/50 my-4 rounded-xl";
  const titleStyles = "text-lg font-semibold text-white";
  const subtitleStyles = "text-sm font-normal text-gray-200 mb-1";
  const contentStyles = "flex flex-col gap-2 p-4 w-full";
  const textareaStyles = "w-full p-2 rounded-xl focus:outline-purple-500 border shadow-inner min-h-[100px] bg-white";
  const buttonStyles = "px-4 py-2 bg-black text-white rounded-xl hover:bg-gray-700 transition-colors";
  const eventStyles = "h-[300px] w-full overflow-auto p-3";
  const preStyles = "whitespace-pre-wrap break-words text-sm m-0 w-full";

  return (
    <div className={wrapperStyles}>
      <div className={contentStyles}>
        <h3 className={titleStyles}>
          🙋 {event.name} <span className={subtitleStyles}>({event.type})</span>
        </h3>
        
        <p className="text-white">The agent wants you to see...</p>
        <div className="bg-white rounded-xl border shadow-inner w-full">
          <div className={eventStyles}>
            <pre className={preStyles}>{JSON.stringify(event.value, null, 2)}</pre>
          </div>
        </div>

        <p className="mt-6 text-white">How do you want to respond?</p>
        <textarea 
          className={textareaStyles} 
          placeholder="Enter your response"
          value={response}
          onChange={(e) => setResponse(e.target.value)}
        />
        
        <div className="flex justify-center mt-4">
          <button 
            onClick={() => resolve(event.value)}
            className={buttonStyles}
          >
            Respond
          </button>
        </div>
      </div>
    </div>
  )
}
