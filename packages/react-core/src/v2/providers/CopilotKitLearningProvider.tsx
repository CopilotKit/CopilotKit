"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  ProductInteractionCaptureOptions,
  ProductInteractionEvent,
} from "@copilotkit/learning";
import { LearningProvider } from "@copilotkit/learning/react";
import { randomUUID } from "@copilotkit/shared";
import { useCopilotKit } from "../context";
import { useLearnFromUserAction } from "../hooks/use-learn-from-user-action";
import { createProductEventRecorder } from "../lib/product-event-recorder";
import { useCopilotChatConfiguration } from "./CopilotChatConfigurationProvider";

export interface CopilotKitLearningConfig extends Omit<
  ProductInteractionCaptureOptions,
  "onEvent"
> {
  /** Attach actions to this thread; otherwise use the enclosing chat or a product-only session. */
  threadId?: string;
  /** Assign a product-only session to this Learning container without an agent run. */
  learningContainerId?: string;
  /** Called for transport errors or dropped events when the delivery queue is full. */
  onError?: (error: Error) => void;
}

export interface CopilotKitLearningProviderProps extends CopilotKitLearningConfig {
  children?: ReactNode;
}

/**
 * Connect generic browser capture to the existing user-action annotation API.
 * CopilotKitProvider includes this automatically when Intelligence is available.
 * To scope capture to a chat thread, disable that default with `learning={false}`
 * and mount this provider inside the chat configuration instead.
 */
export function CopilotKitLearningProvider({
  children,
  threadId,
  learningContainerId,
  enabled,
  onError,
  excludedUrlPrefixes,
  ...captureOptions
}: CopilotKitLearningProviderProps) {
  const { copilotkit } = useCopilotKit();
  const chat = useCopilotChatConfiguration();
  const record = useLearnFromUserAction();
  const [sessionId] = useState(randomUUID);
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
  const effectiveThreadId = threadId ?? chat?.threadId ?? sessionId;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const recorderRef = useRef<ReturnType<
    typeof createProductEventRecorder
  > | null>(null);

  useEffect(() => {
    if (!captureEnabled) return;
    const recorder = createProductEventRecorder({
      record,
      threadId: effectiveThreadId,
      learningContainerId,
      onError: (error) => {
        if (onErrorRef.current) return onErrorRef.current(error);
        else console.warn("[CopilotKit learning]", error);
      },
    });
    recorderRef.current = recorder;
    return () => {
      recorderRef.current = null;
      recorder.stop();
    };
  }, [
    captureEnabled,
    effectiveThreadId,
    learningContainerId,
    record,
    runtimeUrl,
  ]);

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
        key={JSON.stringify([
          effectiveThreadId,
          learningContainerId,
          runtimeUrl,
        ])}
        {...captureOptions}
        enabled={captureEnabled}
        excludedUrlPrefixes={excludedUrls}
        onEvent={onEvent}
      />
      {/* Retire in-flight captures on scope changes without remounting the app. */}
      {children}
    </>
  );
}
