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
import { ɵAudioRecorder, ɵcreateWaveformRenderer } from "@copilotkit/core";
import { cn } from "../../utils";
import type {
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
        class="cpk-audio-recorder-canvas"
        [style.imageRendering]="'pixelated'"
      ></canvas>
    </div>
  `,
  host: {
    "[class.copilot-chat-audio-recorder]": "true",
  },
})
/**
 * Records from the microphone and draws the live level as a scrolling
 * waveform. The recording itself is `ɵAudioRecorder` from
 * `@copilotkit/core`.
 */
export class CopilotChatAudioRecorder implements AfterViewInit {
  private readonly canvasRef =
    viewChild.required<ElementRef<HTMLCanvasElement>>("canvasRef");

  inputClass = input<string | undefined>();
  inputShowControls = input<boolean>(false);

  stateChange = output<AudioRecorderState>();
  error = output<AudioRecorderError>();

  private readonly recorder = new ɵAudioRecorder();
  readonly state = signal<AudioRecorderState>(this.recorder.getSnapshot());

  readonly computedClass = computed(() => {
    return cn("cpk-audio-recorder", this.inputClass());
  });

  private waveform?: { dispose: () => void };

  constructor() {
    const unsubscribe = this.recorder.subscribe(() => {
      const state = this.recorder.getSnapshot();
      this.state.set(state);
      this.stateChange.emit(state);
    });
    inject(DestroyRef).onDestroy(() => {
      this.waveform?.dispose();
      this.dispose();
      unsubscribe();
    });
  }

  ngAfterViewInit(): void {
    this.waveform = ɵcreateWaveformRenderer(
      this.canvasRef().nativeElement,
      this.recorder,
    );
  }

  /**
   * Request microphone access and start recording.
   *
   * @throws {AudioRecorderError} When the recorder is already starting or
   *   recording, or the microphone cannot be used. `error` emits it too.
   */
  start(): Promise<void> {
    return this.recorder.start().catch((error: AudioRecorderError) => {
      this.error.emit(error);
      throw error;
    });
  }

  /**
   * Stop recording and resolve with the captured audio.
   *
   * @throws {AudioRecorderError} When nothing records or the recording
   *   fails. `error` emits it too.
   */
  stop(): Promise<Blob> {
    return this.recorder.stop().catch((error: AudioRecorderError) => {
      this.error.emit(error);
      throw error;
    });
  }

  getState(): AudioRecorderState {
    return this.state();
  }

  /**
   * Release every capture resource. Safe to call repeatedly.
   */
  dispose(): void {
    this.recorder.dispose();
  }
}
