"use client";
import React from "react";
import { useCoagentsCrewStarter } from "@/hooks/use-coagents-crew-starter";

export default function CoagentsCrewStarter() {
  const { output } = useCoagentsCrewStarter({
    crewName: "<REPLACE_WITH_YOUR_CREW_NAME>",
    /**
     * List of input required to start your crew (location e.g)
     */
    inputs: ["location"],
  });
  return (
    <>
      {/* Existing markup */}
      {output ? (
        <pre
          style={{
            width: "500px",
            height: "500px",
            whiteSpace: "pre-wrap",
            wordWrap: "break-word",
          }}
        >
          {output}
        </pre>
      ) : null}
    </>
  );
}
