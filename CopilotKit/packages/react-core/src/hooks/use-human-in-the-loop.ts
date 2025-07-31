import { useFrontendTool, ReactFrontendTool } from "./use-frontend-tool";
import { useState, useCallback, useRef } from "react";
import React from "react";
import z from "zod";

export type ReactHumanInTheLoop<T> = {
  name: string;
  description?: string;
  parameters?: z.ZodType<T>;
  render: React.ComponentType<
    | {
        name: string;
        description: string;
        args: Partial<T>;
        status: "inProgress";
        result: undefined;
        respond: undefined;
      }
    | {
        name: string;
        description: string;
        args: T;
        status: "executing";
        result: undefined;
        respond: (result: unknown) => Promise<void>;
      }
    | {
        name: string;
        description: string;
        args: T;
        status: "complete";
        result: unknown;
        respond: undefined;
      }
  >;
};

export function useHumanInTheLoop<T extends Record<string, any> = {}>(
  tool: ReactHumanInTheLoop<T>,
) {}
