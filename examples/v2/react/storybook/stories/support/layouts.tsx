import React from "react";
import type { Decorator } from "@storybook/react-vite";

/** A centered reading column, the width a chat transcript usually gets. */
export const withMessageColumn: Decorator = (Story) => (
  <div className="mx-auto w-full max-w-2xl px-6 py-10">
    <Story />
  </div>
);

/** A centered stage for small standalone controls (inputs, pills, buttons). */
export const withCenteredStage: Decorator = (Story) => (
  <div className="flex min-h-[360px] items-center justify-center p-6">
    <div className="w-full max-w-2xl">
      <Story />
    </div>
  </div>
);

/** Full-viewport frame for views that manage their own scrolling. */
export const withFullHeight: Decorator = (Story) => (
  <div className="h-screen overflow-hidden">
    <Story />
  </div>
);
