/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — useHumanInTheLoop:
 *   V2 import and usage:
 *     import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
 *     import { z } from "zod";
 *
 *     function Confirmation() {
 *       useHumanInTheLoop({
 *         name: "confirmAction",
 *         description: "Ask the user to confirm",
 *         parameters: z.object({}),
 *         render: ({ respond }) => (
 *           <button onClick={() => respond?.(true)}>Confirm</button>
 *         ),
 *       });
 *       return null;
 *     }
 *   V2 replacement source: packages/react-core/src/v2/hooks/use-human-in-the-loop.tsx
 *   V2 docs: https://docs.copilotkit.ai/reference/v2/hooks/useHumanInTheLoop
 *   Migration note: The v2 API uses a Zod schema instead of the v1 Parameter[] shape.
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/react-core/src/hooks/use-human-in-the-loop.ts
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import type { ActionRenderPropsWait, FrontendAction } from "../types";
import { ActionRenderProps } from "../types";
import type { MappedParameterTypes, Parameter } from "@copilotkit/shared";
import {
  CopilotKitError,
  CopilotKitErrorCode,
  getZodParameters,
  parseJson,
} from "@copilotkit/shared";
import { useHumanInTheLoop as useHumanInTheLoopVNext } from "../v2";
import { ToolCallStatus } from "@copilotkit/core";
import type { FunctionComponent } from "react";
import React, { ComponentType, useEffect, useRef } from "react";

type HumanInTheLoopOptions = Parameters<typeof useHumanInTheLoopVNext>[0];
type HumanInTheLoopRender = HumanInTheLoopOptions["render"];
type HumanInTheLoopRenderArgs = HumanInTheLoopRender extends (
  props: infer P,
) => any
  ? P
  : never;

export type UseHumanInTheLoopArgs<T extends Parameter[] | [] = []> = {
  available?: "disabled" | "enabled";
  render: FrontendAction<T>["renderAndWaitForResponse"];
  followUp?: FrontendAction<T>["followUp"];
} & Pick<FrontendAction<T>, "name" | "description" | "parameters">;

type HitlRendererArgs =
  | {
      name: string;
      description: string;
      args: Partial<Record<string, unknown>>;
      status: ToolCallStatus.InProgress;
      result: undefined;
      respond: undefined;
    }
  | {
      name: string;
      description: string;
      args: Record<string, unknown>;
      status: ToolCallStatus.Executing;
      result: undefined;
      respond: (result: unknown) => Promise<void>;
    }
  | {
      name: string;
      description: string;
      args: Record<string, unknown>;
      status: ToolCallStatus.Complete;
      result: string;
      respond: undefined;
    };
type HitlRenderer = FunctionComponent<HitlRendererArgs>;

/**
 * @deprecated The v1 SDK is deprecated. Use v2 instead. Use `useHumanInTheLoop` from `@copilotkit/react-core/v2` instead.
 *
 * ```tsx
 * import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
 * import { z } from "zod";
 *
 * function Confirmation() {
 *   useHumanInTheLoop({
 *     name: "confirmAction",
 *     description: "Ask the user to confirm",
 *     parameters: z.object({}),
 *     render: ({ respond }) => (
 *       <button onClick={() => respond?.(true)}>Confirm</button>
 *     ),
 *   });
 *   return null;
 * }
 * ```
 * See https://docs.copilotkit.ai/reference/v2/hooks/useHumanInTheLoop
 */
export function useHumanInTheLoop<const T extends Parameter[] | [] = []>(
  tool: UseHumanInTheLoopArgs<T>,
  dependencies?: any[],
) {
  const { render, ...toolRest } = tool;
  const { name, description, parameters, followUp } = toolRest;
  const zodParameters = getZodParameters(parameters);
  const renderRef = useRef<HitlRenderer | null>(null);

  useEffect(() => {
    renderRef.current = (args: HitlRendererArgs): React.ReactElement | null => {
      if (typeof render === "string") {
        return React.createElement(React.Fragment, null, render);
      }

      if (!render) {
        return null;
      }

      const renderProps: ActionRenderPropsWait<T> = (() => {
        const mappedArgs = args.args as unknown as MappedParameterTypes<T>;

        switch (args.status) {
          case ToolCallStatus.InProgress:
            return {
              args: mappedArgs,
              respond: args.respond,
              status: args.status,
              handler: undefined,
            };
          case ToolCallStatus.Executing:
            return {
              args: mappedArgs,
              respond: args.respond,
              status: args.status,
              handler: () => {},
            };
          case ToolCallStatus.Complete:
            return {
              args: mappedArgs,
              respond: args.respond,
              status: args.status,
              result: args.result
                ? parseJson(args.result, args.result)
                : args.result,
              handler: undefined,
            };
          default:
            throw new CopilotKitError({
              code: CopilotKitErrorCode.UNKNOWN,
              message: `Invalid tool call status: ${(args as unknown as { status: string }).status}`,
            });
        }
      })();

      const rendered = render(renderProps);

      if (typeof rendered === "string") {
        return React.createElement(React.Fragment, null, rendered);
      }

      return rendered ?? null;
    };
  }, [render, ...(dependencies ?? [])]);

  useHumanInTheLoopVNext({
    name,
    description,
    followUp,
    parameters: zodParameters,
    render: ((args: HumanInTheLoopRenderArgs) =>
      renderRef.current?.(args as HitlRendererArgs) ??
      null) as HumanInTheLoopOptions["render"],
  });
}
