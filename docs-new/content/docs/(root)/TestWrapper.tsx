"use client";

import { useState } from "react";
import React from "react";

export function TestWrapper({ children }) {
  const [llmProvider, setLLMProvider] = useState<string | null>("openai");
  return (
    <>
      {React.Children.map(children, (child) => {
        if (child) {
          return React.cloneElement(child, { llmProvider });
        }
      })}
    </>
  );
}
