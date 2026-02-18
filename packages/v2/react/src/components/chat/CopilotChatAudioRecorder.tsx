import {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
  useState,
} from "react";
import { twMerge } from "tailwind-merge";

/** Finite-state machine for every recorder implementation */
export type AudioRecorderState = "idle" | "recording" | "processing";

/** Error subclass so callers can `instanceof`-guard recorder failures */
export class AudioRecorderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioRecorderError";
  }
}

export interface AudioRecorderRef {
  state: AudioRecorderState;
  start: () => Promise<void>;
  stop: () => Promise<Blob>;
  dispose: () => void;
}

export const CopilotChatAudioRecorder = forwardRef<
  AudioRecorderRef,
  React.HTMLAttributes<HTMLDivElement>
>((props, ref) => {
  const { className, ...divProps } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Recording state
  const [recorderState, setRecorderState] =
    useState<AudioRecorderState>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationIdRef = useRef<number | null>(null);

  // Amplitude history buffer for scrolling waveform
  const amplitudeHistoryRef = useRef<number[]>([]);
  const frameCountRef = useRef<number>(0);
  const scrollOffsetRef = useRef<number>(0);
  const smoothedAmplitudeRef = useRef<number>(0);
  const fadeOpacityRef = useRef<number>(0);

  // Clean up all resources
  const cleanup = useCallback(() => {
    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignore errors during cleanup
      }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {
        // Ignore close errors
      });
      audioContextRef.current = null;
    }
    mediaRecorderRef.current = null;
    analyserRef.current = null;
    audioChunksRef.current = [];
    amplitudeHistoryRef.current = [];
    frameCountRef.current = 0;
    scrollOffsetRef.current = 0;
    smoothedAmplitudeRef.current = 0;
    fadeOpacityRef.current = 0;
  }, []);

  // Start recording
  const start = useCallback(async () => {
    if (recorderState !== "idle") {
      throw new AudioRecorderError("Recorder is already active");
    }

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up audio context for visualization
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048; // Higher resolution for time-domain waveform
      source.connect(analyser);
      analyserRef.current = analyser;

      // Determine best MIME type for recording
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : "";

      const options: MediaRecorderOptions = mimeType ? { mimeType } : {};
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Start recording with timeslice to collect data periodically
      mediaRecorder.start(100);
      setRecorderState("recording");
    } catch (error) {
      cleanup();
      if (error instanceof Error && error.name === "NotAllowedError") {
        throw new AudioRecorderError("Microphone permission denied");
      }
      if (error instanceof Error && error.name === "NotFoundError") {
        throw new AudioRecorderError("No microphone found");
      }
      throw new AudioRecorderError(
        error instanceof Error ? error.message : "Failed to start recording",
      );
    }
  }, [recorderState, cleanup]);

  // Stop recording and return audio blob
  const stop = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const mediaRecorder = mediaRecorderRef.current;
      if (!mediaRecorder || recorderState !== "recording") {
        reject(new AudioRecorderError("No active recording"));
        return;
      }

      setRecorderState("processing");

      mediaRecorder.onstop = () => {
        const mimeType = mediaRecorder.mimeType || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });

        // Clean up but keep the blob
        cleanup();
        setRecorderState("idle");
        resolve(audioBlob);
      };

      mediaRecorder.onerror = () => {
        cleanup();
        setRecorderState("idle");
        reject(new AudioRecorderError("Recording failed"));
      };

      mediaRecorder.stop();
    });
  }, [recorderState, cleanup]);

  // Calculate RMS amplitude from time-domain data
  const calculateAmplitude = (dataArray: Uint8Array): number => {
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      // Normalize to -1 to 1 range (128 is center/silence)
      const sample = (dataArray[i] ?? 128) / 128 - 1;
      sum += sample * sample;
    }
    return Math.sqrt(sum / dataArray.length);
  };

  // Canvas rendering with animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Configuration
    const barWidth = 2;
    const barGap = 1;
    const barSpacing = barWidth + barGap;
    const scrollSpeed = 1 / 3; // Pixels per frame

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      // Update canvas dimensions if container resized
      if (
        canvas.width !== rect.width * dpr ||
        canvas.height !== rect.height * dpr
      ) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
      }

      // Calculate how many bars fit in the canvas (plus extra for smooth scrolling)
      const maxBars = Math.floor(rect.width / barSpacing) + 2;

      // Get current amplitude if recording
      if (analyserRef.current && recorderState === "recording") {
        // Pre-fill history with zeros on first frame so line is visible immediately
        if (amplitudeHistoryRef.current.length === 0) {
          amplitudeHistoryRef.current = new Array(maxBars).fill(0);
        }

        // Fade in the waveform smoothly
        if (fadeOpacityRef.current < 1) {
          fadeOpacityRef.current = Math.min(1, fadeOpacityRef.current + 0.03);
        }

        // Smooth scrolling - increment offset every frame
        scrollOffsetRef.current += scrollSpeed;

        // Sample amplitude every frame for smoothing
        const bufferLength = analyserRef.current.fftSize;
        const dataArray = new Uint8Array(bufferLength);
        analyserRef.current.getByteTimeDomainData(dataArray);
        const rawAmplitude = calculateAmplitude(dataArray);

        // Smoothing: gradual attack and decay
        const attackSpeed = 0.12; // Smooth rise
        const decaySpeed = 0.08; // Smooth fade out
        const speed =
          rawAmplitude > smoothedAmplitudeRef.current
            ? attackSpeed
            : decaySpeed;
        smoothedAmplitudeRef.current +=
          (rawAmplitude - smoothedAmplitudeRef.current) * speed;

        // When offset reaches a full bar width, add a new sample and reset offset
        if (scrollOffsetRef.current >= barSpacing) {
          scrollOffsetRef.current -= barSpacing;
          amplitudeHistoryRef.current.push(smoothedAmplitudeRef.current);

          // Trim history to fit canvas
          if (amplitudeHistoryRef.current.length > maxBars) {
            amplitudeHistoryRef.current =
              amplitudeHistoryRef.current.slice(-maxBars);
          }
        }
      }

      // Clear canvas
      ctx.clearRect(0, 0, rect.width, rect.height);

      // Get current foreground color
      const computedStyle = getComputedStyle(canvas);
      ctx.fillStyle = computedStyle.color;
      ctx.globalAlpha = fadeOpacityRef.current;

      const centerY = rect.height / 2;
      const maxAmplitude = rect.height / 2 - 2; // Leave some padding

      const history = amplitudeHistoryRef.current;

      // Only draw when recording (history has data)
      if (history.length > 0) {
        const offset = scrollOffsetRef.current;
        const edgeFadeWidth = 12; // Pixels to fade at each edge

        for (let i = 0; i < history.length; i++) {
          const amplitude = history[i] ?? 0;
          // Scale amplitude (RMS is typically 0-0.5 for normal speech)
          const scaledAmplitude = Math.min(amplitude * 4, 1);
          const barHeight = Math.max(2, scaledAmplitude * maxAmplitude * 2);

          // Position: right-aligned with smooth scroll offset
          const x = rect.width - (history.length - i) * barSpacing - offset;
          const y = centerY - barHeight / 2;

          // Only draw if visible
          if (x + barWidth > 0 && x < rect.width) {
            // Calculate edge fade opacity
            let edgeOpacity = 1;
            if (x < edgeFadeWidth) {
              // Fade out on left edge
              edgeOpacity = Math.max(0, x / edgeFadeWidth);
            } else if (x > rect.width - edgeFadeWidth) {
              // Fade in on right edge
              edgeOpacity = Math.max(0, (rect.width - x) / edgeFadeWidth);
            }

            ctx.globalAlpha = fadeOpacityRef.current * edgeOpacity;
            ctx.fillRect(x, y, barWidth, barHeight);
          }
        }
      }

      animationIdRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
    };
  }, [recorderState]);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Expose AudioRecorder API via ref
  useImperativeHandle(
    ref,
    () => ({
      get state() {
        return recorderState;
      },
      start,
      stop,
      dispose: cleanup,
    }),
    [recorderState, start, stop, cleanup],
  );

  return (
    <div className={twMerge("w-full py-3 px-5", className)} {...divProps}>
      <canvas ref={canvasRef} className="block w-full h-[26px]" />
    </div>
  );
});

CopilotChatAudioRecorder.displayName = "CopilotChatAudioRecorder";
