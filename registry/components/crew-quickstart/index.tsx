"use client";
import React from "react";
import useCrewQuickstart from "./use-crew-quickstart";
import { useCoAgent } from "@copilotkit/react-core";
import { useEffect } from "react";

export default function YourApp() {
  const { output } = useCrewQuickstart({
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
