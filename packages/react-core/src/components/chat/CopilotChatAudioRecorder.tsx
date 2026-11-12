import {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useState,
} from "react";
import { ɵAudioRecorder, ɵcreateWaveformRenderer } from "@copilotkit/core";
import type { ɵAudioRecorderState } from "@copilotkit/core";
import { cn } from "../../lib/utils";

/** Finite-state machine for every recorder implementation */
export type AudioRecorderState = ɵAudioRecorderState;

/** Error subclass so callers can `instanceof`-guard recorder failures */
export { ɵAudioRecorderError as AudioRecorderError } from "@copilotkit/core";

export interface AudioRecorderRef {
  state: AudioRecorderState;
  start: () => Promise<void>;
  stop: () => Promise<Blob>;
  dispose: () => void;
}

/**
 * Records from the microphone and draws the live level as a scrolling
 * waveform. The recording itself is `ɵAudioRecorder` from
 * `@copilotkit/core`; control it through the ref.
 */
export const CopilotChatAudioRecorder = forwardRef<
  AudioRecorderRef,
  React.HTMLAttributes<HTMLDivElement>
>((props, ref) => {
  const { className, ...divProps } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [recorder] = useState(() => new ɵAudioRecorder());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const waveform = ɵcreateWaveformRenderer(canvas, recorder);
    return () => waveform.dispose();
  }, [recorder]);

  useEffect(() => () => recorder.dispose(), [recorder]);

  useImperativeHandle(
    ref,
    () => ({
      get state() {
        return recorder.getSnapshot();
      },
      start: () => recorder.start(),
      stop: () => recorder.stop(),
      dispose: () => recorder.dispose(),
    }),
    [recorder],
  );

  return (
    <div className={cn("cpk-audio-recorder", className)} {...divProps}>
      <canvas ref={canvasRef} className="cpk-audio-recorder-canvas" />
    </div>
  );
});

CopilotChatAudioRecorder.displayName = "CopilotChatAudioRecorder";
