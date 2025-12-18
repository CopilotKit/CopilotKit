import { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
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

export const CopilotChatAudioRecorder = forwardRef<
  any,
  React.HTMLAttributes<HTMLDivElement>
>((props, ref) => {
  const { className, ...divProps } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Generate fake waveform that moves with time
  const getLoudness = (n: number): number[] => {
    const elapsed = Date.now() / 1000; // Use current timestamp directly
    const samples: number[] = [];

    for (let i = 0; i < n; i++) {
      // Create a position that moves from left to right over time
      const position = (i / n) * 10 + elapsed * 0.5; // Scroll speed (slower)

      // Generate waveform using multiple sine waves for realism
      const wave1 = Math.sin(position * 2) * 0.3;
      const wave2 = Math.sin(position * 5 + elapsed) * 0.2;
      const wave3 = Math.sin(position * 0.5 + elapsed * 0.3) * 0.4;

      // Add some randomness for natural variation
      const noise = (Math.random() - 0.5) * 0.1;

      // Combine waves and add envelope for realistic amplitude variation
      const envelope = Math.sin(elapsed * 0.7) * 0.5 + 0.5; // Slow amplitude modulation
      let amplitude = (wave1 + wave2 + wave3 + noise) * envelope;

      // Clamp to 0-1 range
      amplitude = Math.max(0, Math.min(1, amplitude * 0.5 + 0.3));

      samples.push(amplitude);
    }

    return samples;
  };

  // No setup needed - stub implementation

  // Canvas rendering with 60fps animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;

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
        ctx.imageSmoothingEnabled = false;
      }

      // Configuration
      const barWidth = 2;
      const minHeight = 2;
      const maxHeight = 20;
      const gap = 2;
      const numSamples = Math.ceil(rect.width / (barWidth + gap));

      // Get loudness data
      const loudnessData = getLoudness(numSamples);

      // Clear canvas
      ctx.clearRect(0, 0, rect.width, rect.height);

      // Get current foreground color
      const computedStyle = getComputedStyle(canvas);
      const currentForeground = computedStyle.color;

      // Draw bars
      ctx.fillStyle = currentForeground;
      const centerY = rect.height / 2;

      for (let i = 0; i < loudnessData.length; i++) {
        const sample = loudnessData[i] ?? 0;
        const barHeight = Math.round(
          sample * (maxHeight - minHeight) + minHeight
        );
        const x = Math.round(i * (barWidth + gap));
        const y = Math.round(centerY - barHeight / 2);

        ctx.fillRect(x, y, barWidth, barHeight);
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, []);

  // Expose AudioRecorder API
  useImperativeHandle(
    ref,
    () => ({
      get state() {
        return "idle" as AudioRecorderState;
      },
      start: async () => {
        // Stub implementation - no actual recording
      },
      stop: () =>
        new Promise<Blob>((resolve) => {
          // Stub implementation - return empty blob
          const emptyBlob = new Blob([], { type: "audio/webm" });
          resolve(emptyBlob);
        }),
      dispose: () => {
        // No cleanup needed
      },
    }),
    []
  );

  return (
    <div className={twMerge("h-[44px] w-full px-5", className)} {...divProps}>
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
});

CopilotChatAudioRecorder.displayName = "WebAudioRecorder";
