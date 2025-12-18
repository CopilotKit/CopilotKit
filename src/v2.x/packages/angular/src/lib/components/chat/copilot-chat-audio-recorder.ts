import {
  Component,
  input,
  output,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  signal,
  computed,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";
import {
  AudioRecorderState,
  AudioRecorderError,
} from "./copilot-chat-input.types";

@Component({
  selector: "copilot-chat-audio-recorder",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div [class]="computedClass()">
      <canvas
        #canvasRef
        class="w-full h-full"
        [style.imageRendering]="'pixelated'"
      ></canvas>
    </div>
  `,
  styles: [],
  host: {
    "[class.copilot-chat-audio-recorder]": "true",
  },
})
export class CopilotChatAudioRecorder implements AfterViewInit, OnDestroy {
  @ViewChild("canvasRef", { static: true })
  canvasRef!: ElementRef<HTMLCanvasElement>;

  inputClass = input<string | undefined>();
  inputShowControls = input<boolean>(false);

  stateChange = output<AudioRecorderState>();
  error = output<AudioRecorderError>();

  // Signals for state management
  state = signal<AudioRecorderState>("idle");
  showControls = signal<boolean>(false);

  // Computed values
  computedClass = computed(() => {
    const baseClasses = "h-11 w-full px-5";
    return `${baseClasses} ${this.inputClass() || ""}`;
  });

  statusText = computed(() => {
    switch (this.state()) {
      case "recording":
        return "Recording...";
      case "processing":
        return "Processing...";
      default:
        return "Ready";
    }
  });

  // Animation and canvas properties
  private animationFrameId?: number;

  // Sync inputShowControls into internal signal
  constructor() {
    // Use microtask to avoid constructor signal writes complaint in some setups
    Promise.resolve().then(() => {
      this.showControls.set(this.inputShowControls() ?? false);
    });
  }

  ngAfterViewInit(): void {
    this.startAnimation();
  }

  ngOnDestroy(): void {
    this.dispose();
  }

  /**
   * Start recording audio
   */
  async start(): Promise<void> {
    try {
      if (this.state() === "recording") {
        return;
      }

      this.setState("recording");
      this.startAnimation();

      // In a real implementation, this would start actual audio recording
      // For now, we just simulate the recording state
    } catch (err) {
      const error = new AudioRecorderError(
        err instanceof Error ? err.message : "Failed to start recording"
      );
      this.error.emit(error);
      this.setState("idle");
      throw error;
    }
  }

  /**
   * Stop recording audio and return blob
   */
  async stop(): Promise<Blob> {
    try {
      this.setState("idle");
      // Return empty blob - stub implementation
      const emptyBlob = new Blob([], { type: "audio/webm" });
      return emptyBlob;
    } catch (err) {
      const error = new AudioRecorderError(
        err instanceof Error ? err.message : "Failed to stop recording"
      );
      this.error.emit(error);
      this.setState("idle");
      throw error;
    }
  }

  /**
   * Get current recorder state
   */
  getState(): AudioRecorderState {
    return this.state();
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.stopAnimation();
  }

  private setState(state: AudioRecorderState): void {
    this.state.set(state);
    this.stateChange.emit(state);
  }

  private startAnimation(): void {
    const canvas = this.canvasRef.nativeElement;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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
      const loudnessData = this.getLoudness(numSamples);

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

      this.animationFrameId = requestAnimationFrame(draw);
    };

    draw();
  }

  private stopAnimation(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }
  }

  private getLoudness(n: number): number[] {
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
  }
}
