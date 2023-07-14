"use client";

import React from "react";
import { GoodPeopleBadPeople } from "./good-people-bad-people";
import { ThemeProvider } from "next-themes";

export default function StandaloneAppPage() {
  return (
    <ThemeProvider>
      <div className="w-full h-full bg-slate-300">
        <GoodPeopleBadPeople />
      </div>
    </ThemeProvider>
  );
}
