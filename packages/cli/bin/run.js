#!/usr/bin/env node

import { execute } from "@oclif/core";

const main = async () => {
  try {
    await execute({ dir: import.meta.url });
  } catch (error) {
    // Rely on command-level error handling to surface friendly messages.
    // If we reach here it means something happened before oclif handed off to the command.
    const message = error?.message || "Unknown error";
    console.error(message);
    process.exitCode = 1;
  }
};

void main();
