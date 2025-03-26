import React from "react";

interface CrewInChatInputProps {
  status: "inProgress" | "executing" | string;
  inputs: string[];
  onSubmit: (inputs: Record<string, string>) => Promise<void>;
}

/**
 * A form component that renders dynamic input fields for crew interactions.
 * Used to collect user inputs during crew execution in a chat-like interface.
 *
 * @example
 * ```tsx
 * <CrewInChatInput
 *   status="inProgress"
 *   inputs={["query", "context"]}
 *   onSubmit={handleSubmit}
 * />
 * ```
 */
export const CrewInChatInput: React.FC<CrewInChatInputProps> = ({
  status,
  inputs,
  onSubmit,
}) => {
  if (status !== "inProgress" && status !== "executing") {
    return <>Inputs submitted</>;
  }

  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
      onSubmit={async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const inputValues = Object.fromEntries(
          inputs.map((input) => [input, formData.get(input)?.toString() || ""])
        );

        await onSubmit(inputValues);
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {inputs.map((input) => (
          <div
            key={input}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <label htmlFor={input}>{input}</label>
            <textarea
              id={input}
              name={input}
              autoFocus
              placeholder={`Enter ${input} here`}
              required
            />
          </div>
        ))}
        <button
          type="submit"
          style={{
            cursor: "pointer",
          }}
        >
          Submit
        </button>
      </div>
    </form>
  );
};
