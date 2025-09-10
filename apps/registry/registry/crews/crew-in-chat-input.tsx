import React from "react";

/**
 * Props for the CrewInChatInput component
 * 
 * @property status - The current status of the crew operation
 * @property inputs - Array of input field names to render
 * @property onSubmit - Callback function triggered when form is submitted
 */
interface CrewInChatInputProps {
  status: "inProgress" | "executing" | string;
  inputs: string[];
  onSubmit: (inputs: Record<string, string>) => Promise<void>;
}

/**
 * A form component that renders dynamic input fields for crew interactions
 * 
 * This component creates a form with input fields based on the provided
 * input names. It's designed to collect information from users in a 
 * conversational interface during crew execution.
 * 
 * @example
 * ```tsx
 * <CrewInChatInput
 *   status="inProgress"
 *   inputs={["query", "location"]}
 *   onSubmit={async (values) => {
 *     console.log(values); // { query: "...", location: "..." }
 *   }}
 * />
 * ```
 */
export const CrewInChatInput: React.FC<CrewInChatInputProps> = ({
  status,
  inputs,
  onSubmit,
}) => {
  // If not in progress or executing, show that inputs were submitted
  console.log("status", status);
  if (status !== "inProgress" && status !== "executing") {
    return <div className="text-sm text-white italic">Inputs submitted</div>;
  }

  return (
    <form
      className="flex flex-col gap-4 bg-black rounded-lg p-4 border border-zinc-800 shadow-sm"
      onSubmit={async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const inputValues = Object.fromEntries(
          inputs.map((input) => [input, formData.get(input)?.toString() || ""])
        );

        await onSubmit(inputValues);
      }}
    >
      <div className="flex flex-col gap-4">
        {inputs.map((input) => (
          <div
            key={input}
            className="flex flex-col gap-2"
          >
            <label 
              htmlFor={input}
              className="text-sm font-medium text-white capitalize"
            >
              {input}
            </label>
            <textarea
              id={input}
              name={input}
              autoFocus
              placeholder={`Enter ${input} here`}
              required
              className="p-3 border rounded-md border-zinc-800 text-white focus:outline-none"
              rows={3}
            />
          </div>
        ))}
        <button
          type="submit"
          className="px-4 py-2 bg-white hover:bg-zinc-300 active:bg-zinc-400 text-black rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors self-start mt-2 shadow-sm"
        >
          Submit
        </button>
      </div>
    </form>
  );
};
