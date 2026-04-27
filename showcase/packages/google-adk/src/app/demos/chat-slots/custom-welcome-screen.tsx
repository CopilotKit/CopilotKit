"use client";

import React from "react";

export function CustomWelcomeScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="text-5xl mb-4">✨</div>
      <h2 className="text-2xl font-semibold text-slate-800 mb-2">
        Powered by Google ADK
      </h2>
      <p className="text-slate-600 max-w-sm">
        This chat surface uses CopilotChat's slot system — the welcome screen,
        message bubbles, and disclaimer can all be replaced via props.
      </p>
    </div>
  );
}
