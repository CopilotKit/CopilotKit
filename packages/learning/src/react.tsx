"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { startProductInteractionCapture } from "./capture";
import type { ProductInteractionCaptureOptions } from "./types";

export interface LearningProviderProps extends ProductInteractionCaptureOptions {
  children?: ReactNode;
}

/** Compose capture into any React application, with a caller-owned event sink. */
export function LearningProvider({
  children,
  onEvent,
  ...options
}: LearningProviderProps) {
  const callback = useRef(onEvent);
  callback.current = onEvent;
  // Arrays passed inline should not reinstall observers on every render.
  const apiPrefixes = JSON.stringify(options.apiUrlPrefixes);
  const excludedPrefixes = JSON.stringify(options.excludedUrlPrefixes);
  const {
    enabled,
    captureRequests,
    captureRequestBodies,
    captureDomChanges,
    captureContext,
    capturePage,
    captureTextValues,
    captureAccessibleNames,
    maxEventsPerMinute,
    maxRequestsPerAction,
  } = options;
  useEffect(
    () =>
      startProductInteractionCapture({
        enabled,
        captureRequests,
        captureRequestBodies,
        captureDomChanges,
        captureContext,
        capturePage,
        captureTextValues,
        captureAccessibleNames,
        maxEventsPerMinute,
        maxRequestsPerAction,
        apiUrlPrefixes:
          apiPrefixes === undefined ? undefined : JSON.parse(apiPrefixes),
        excludedUrlPrefixes:
          excludedPrefixes === undefined
            ? undefined
            : JSON.parse(excludedPrefixes),
        onEvent: (event) => callback.current(event),
      }),
    [
      enabled,
      captureRequests,
      captureRequestBodies,
      captureDomChanges,
      captureContext,
      capturePage,
      captureTextValues,
      captureAccessibleNames,
      maxEventsPerMinute,
      maxRequestsPerAction,
      apiPrefixes,
      excludedPrefixes,
    ],
  );
  return <>{children}</>;
}

export type {
  ProductInteractionCaptureOptions,
  ProductInteractionEvent,
  ProductInteractionTarget,
  ProductInteractionContext,
  ProductInteractionText,
  ProductControlState,
  ProductPageContext,
  ProductRequestBody,
} from "./types";
