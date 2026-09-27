"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  ProductInteractionCaptureOptions,
  ProductInteractionEvent,
} from "@copilotkit/learning";
import { LearningProvider } from "@copilotkit/learning/react";
import { useCopilotKit } from "../context";
import { useLearnFromUserAction } from "../hooks/use-learn-from-user-action";
import { createProductEventRecorder } from "../lib/product-event-recorder";
import { trackProductChangeThreads } from "../lib/product-change-thread";

export interface CopilotKitLearningConfig extends Omit<
  ProductInteractionCaptureOptions,
  "onEvent"
> {
  /** Called for transport errors or dropped events when the delivery queue is full. */
  onError?: (error: Error) => void;
}

export interface CopilotKitLearningProviderProps extends CopilotKitLearningConfig {
  children?: ReactNode;
}

/**
 * Connect generic browser capture to the existing user-action annotation API.
 * CopilotKitProvider includes this automatically when Intelligence is available.
 * Actions follow the selected chat thread. With multiple chats, pointer or
 * keyboard focus selects the destination; ambiguous/no-thread actions are omitted.
 * Learning eligibility and container membership are controlled by the backend.
 */
export function CopilotKitLearningProvider({
  children,
  enabled,
  onError,
  excludedUrlPrefixes,
  ...captureOptions
}: CopilotKitLearningProviderProps) {
  const { copilotkit } = useCopilotKit();
  const record = useLearnFromUserAction();
  const threads = copilotkit.ɵlearningThreads;
  const [intelligenceAvailable, setIntelligenceAvailable] = useState(
    () => !!copilotkit.intelligence,
  );
  useEffect(() => {
    const sync = () => setIntelligenceAvailable(!!copilotkit.intelligence);
    const subscription = copilotkit.subscribe({
      onRuntimeConnectionStatusChanged: sync,
    });
    sync();
    return () => subscription.unsubscribe();
  }, [copilotkit]);

  const runtimeUrl = copilotkit.runtimeUrl;
  const captureEnabled = !!runtimeUrl && (enabled ?? intelligenceAvailable);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const recorderRef = useRef<ReturnType<
    typeof createProductEventRecorder
  > | null>(null);

  useEffect(() => {
    if (!captureEnabled) return;
    const changeThreads = trackProductChangeThreads(
      window,
      threads.getThreadId,
    );
    const recorder = createProductEventRecorder({
      record,
      getThreadId: changeThreads.getThreadId,
      onError: (error) => {
        if (onErrorRef.current) return onErrorRef.current(error);
        else console.warn("[CopilotKit learning]", error);
      },
    });
    recorderRef.current = recorder;
    return () => {
      recorderRef.current = null;
      recorder.stop();
      changeThreads.stop();
    };
  }, [captureEnabled, threads, record, runtimeUrl]);

  const onEvent = useCallback((event: ProductInteractionEvent) => {
    recorderRef.current?.onEvent(event);
  }, []);
  const excludedUrls = useMemo(
    () => [...(excludedUrlPrefixes ?? []), ...(runtimeUrl ? [runtimeUrl] : [])],
    [excludedUrlPrefixes, runtimeUrl],
  );

  return (
    <>
      <LearningProvider
        key={runtimeUrl}
        {...captureOptions}
        enabled={captureEnabled}
        excludedUrlPrefixes={excludedUrls}
        onEvent={onEvent}
      />
      {children}
    </>
  );
}
