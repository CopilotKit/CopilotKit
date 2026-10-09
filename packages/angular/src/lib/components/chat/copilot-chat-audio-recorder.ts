import {
  Component,
  DestroyRef,
  ElementRef,
  AfterViewInit,
  input,
  output,
  signal,
  computed,
  inject,
  viewChild,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";
import {
  AudioRecorderState,
  AudioRecorderError,
} from "./copilot-chat-input.types";

@Component({
  selector: "copilot-chat-audio-recorder",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div [class]="computedClass()">
      <canvas
        #canvasRef
        class="cpk:w-full cpk:h-full"
        [style.imageRendering]="'pixelated'"
      ></canvas>
    </div>
  `,
  host: {
    "[class.copilot-chat-audio-recorder]": "true",
  },
})
export class CopilotChatAudioRecorder implements AfterViewInit {
  private readonly canvasRef =
    viewChild.required<ElementRef<HTMLCanvasElement>>("canvasRef");

  inputClass = input<string | undefined>();
  inputShowControls = input<boolean>(false);

  stateChange = output<AudioRecorderState>();
  error = output<AudioRecorderError>();

  readonly state = signal<AudioRecorderState>("idle");

  readonly computedClass = computed(() => {
    const baseClasses = "cpk:h-11 cpk:w-full cpk:px-5";
    return `${baseClasses} ${this.inputClass() || ""}`;
  });

  // Capture resources
  private mediaRecorder?: MediaRecorder;
  private stream?: MediaStream;
  private audioContext?: AudioContext;
  private analyser?: AnalyserNode;
  private audioChunks: Blob[] = [];

  // Guards the async window before `state` flips to "recording".
  private starting = false;

  // Waveform animation state
  private animationFrameId?: number;
  private amplitudeHistory: number[] = [];
  private scrollOffset = 0;
  private smoothedAmplitude = 0;
  private fadeOpacity = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.dispose());
  }

  ngAfterViewInit(): void {
    this.startAnimation();
  }

  /**
   * Request microphone access and start recording.
   */
  async start(): Promise<void> {
    if (this.starting || this.state() !== "idle") {
      return;
    }
    this.starting = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.stream = stream;

      // Wire an analyser for the live waveform.
      const audioContext = new AudioContext();
      this.audioContext = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      this.analyser = analyser;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : "";

      const options: MediaRecorderOptions = mimeType ? { mimeType } : {};
      const mediaRecorder = new MediaRecorder(stream, options);
      this.mediaRecorder = mediaRecorder;
      this.audioChunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      mediaRecorder.start(100);
      this.setState("recording");
    } catch (err) {
      this.cleanup();
      const error = this.toRecorderError(err);
      this.error.emit(error);
      this.setState("idle");
      throw error;
    } finally {
      this.starting = false;
    }
  }

  /**
   * Stop recording and resolve with the captured audio.
   */
  stop(): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      const mediaRecorder = this.mediaRecorder;
      if (!mediaRecorder || this.state() !== "recording") {
        reject(new AudioRecorderError("No active recording"));
        return;
      }

      this.setState("processing");

      mediaRecorder.onstop = () => {
        const mimeType = mediaRecorder.mimeType || "audio/webm";
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        this.cleanup();
        this.setState("idle");
        resolve(audioBlob);
      };

      mediaRecorder.onerror = () => {
        this.cleanup();
        const error = new AudioRecorderError("Recording failed");
        this.error.emit(error);
        this.setState("idle");
        reject(error);
      };

      mediaRecorder.stop();
    });
  }

  getState(): AudioRecorderState {
    return this.state();
  }

  /**
   * Release every capture/animation resource. Safe to call repeatedly.
   */
  dispose(): void {
    this.cleanup();
  }

  private setState(state: AudioRecorderState): void {
    this.state.set(state);
    this.stateChange.emit(state);
  }

  private toRecorderError(err: unknown): AudioRecorderError {
    if (err instanceof Error && err.name === "NotAllowedError") {
      return new AudioRecorderError("Microphone permission denied");
    }
    if (err instanceof Error && err.name === "NotFoundError") {
      return new AudioRecorderError("No microphone found");
    }
    return new AudioRecorderError(
      err instanceof Error ? err.message : "Failed to start recording",
    );
  }

  private cleanup(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try {
        this.mediaRecorder.stop();
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close().catch(() => {});
    }
    this.mediaRecorder = undefined;
    this.stream = undefined;
    this.audioContext = undefined;
    this.analyser = undefined;
    this.audioChunks = [];
    this.amplitudeHistory = [];
    this.scrollOffset = 0;
    this.smoothedAmplitude = 0;
    this.fadeOpacity = 0;
  }

  /** RMS amplitude from time-domain samples (128 is silence). */
  private calculateAmplitude(dataArray: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const sample = (dataArray[i] ?? 128) / 128 - 1;
      sum += sample * sample;
    }
    return Math.sqrt(sum / dataArray.length);
  }

  private startAnimation(): void {
    const canvas = this.canvasRef().nativeElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const barWidth = 2;
    const barGap = 1;
    const barSpacing = barWidth + barGap;
    const scrollSpeed = 1 / 3;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      if (
        canvas.width !== rect.width * dpr ||
        canvas.height !== rect.height * dpr
      ) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
      }

      const maxBars = Math.floor(rect.width / barSpacing) + 2;

      if (this.analyser && this.state() === "recording") {
        if (this.amplitudeHistory.length === 0) {
          this.amplitudeHistory = new Array(maxBars).fill(0);
        }

        if (this.fadeOpacity < 1) {
          this.fadeOpacity = Math.min(1, this.fadeOpacity + 0.03);
        }

        this.scrollOffset += scrollSpeed;

        const bufferLength = this.analyser.fftSize;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteTimeDomainData(dataArray);
        const rawAmplitude = this.calculateAmplitude(dataArray);

        const attackSpeed = 0.12;
        const decaySpeed = 0.08;
        const speed =
          rawAmplitude > this.smoothedAmplitude ? attackSpeed : decaySpeed;
        this.smoothedAmplitude +=
          (rawAmplitude - this.smoothedAmplitude) * speed;

        if (this.scrollOffset >= barSpacing) {
          this.scrollOffset -= barSpacing;
          this.amplitudeHistory.push(this.smoothedAmplitude);
          if (this.amplitudeHistory.length > maxBars) {
            this.amplitudeHistory = this.amplitudeHistory.slice(-maxBars);
          }
        }
      }

      ctx.clearRect(0, 0, rect.width, rect.height);

      const computedStyle = getComputedStyle(canvas);
      ctx.fillStyle = computedStyle.color;
      ctx.globalAlpha = this.fadeOpacity;

      const centerY = rect.height / 2;
      const maxAmplitude = rect.height / 2 - 2;
      const history = this.amplitudeHistory;

      if (history.length > 0) {
        const offset = this.scrollOffset;
        const edgeFadeWidth = 12;

        for (let i = 0; i < history.length; i++) {
          const amplitude = history[i] ?? 0;
          const scaledAmplitude = Math.min(amplitude * 4, 1);
          const barHeight = Math.max(2, scaledAmplitude * maxAmplitude * 2);

          const x = rect.width - (history.length - i) * barSpacing - offset;
          const y = centerY - barHeight / 2;

          if (x + barWidth > 0 && x < rect.width) {
            let edgeOpacity = 1;
            if (x < edgeFadeWidth) {
              edgeOpacity = Math.max(0, x / edgeFadeWidth);
            } else if (x > rect.width - edgeFadeWidth) {
              edgeOpacity = Math.max(0, (rect.width - x) / edgeFadeWidth);
            }
            ctx.globalAlpha = this.fadeOpacity * edgeOpacity;
            ctx.fillRect(x, y, barWidth, barHeight);
          }
        }
      }

      this.animationFrameId = requestAnimationFrame(draw);
    };

    draw();
  }
}
