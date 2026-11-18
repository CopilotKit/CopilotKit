/**
 * Microphone recording and the live waveform for the chat input.
 *
 * React, Vue, and Angular wrap {@link ɵAudioRecorder} in their recorder
 * component and draw its level with {@link ɵcreateWaveformRenderer}. Send
 * the recorded blob to the runtime with `ɵtranscribeAudio`.
 *
 * Nothing here touches the browser at import time, so it is safe to import
 * during server rendering.
 */

/** What the recorder does: nothing, recording, or finishing a recording. */
export type ɵAudioRecorderState = "idle" | "recording" | "processing";

/**
 * The error the recorder throws. Its `message` says what failed:
 * `"Recorder is already active"`, `"Microphone permission denied"`,
 * `"No microphone found"`, `"No active recording"`, `"Recording failed"`, or
 * the browser's own message.
 */
export class ɵAudioRecorderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioRecorderError";
  }
}

/** The recording formats to try, best first. */
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
/** A larger FFT gives a finer time-domain waveform. */
const FFT_SIZE = 2048;
/** How often, in ms, the recorder hands over a chunk of audio. */
const TIMESLICE_MS = 100;

function pickMimeType() {
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function toRecorderError(error: unknown) {
  const name = error instanceof Error ? error.name : undefined;
  switch (name) {
    case "NotAllowedError":
      return new ɵAudioRecorderError("Microphone permission denied");
    case "NotFoundError":
      return new ɵAudioRecorderError("No microphone found");
    case undefined:
    default:
      return new ɵAudioRecorderError(
        error instanceof Error ? error.message : "Failed to start recording",
      );
  }
}

/**
 * Records audio from the microphone.
 *
 * The state goes `"idle"` → `"recording"` (after `start()`) → `"processing"`
 * (after `stop()`) → `"idle"` (when the blob is ready). Read it with
 * `getSnapshot()` and `subscribe()`.
 *
 * @example
 * ```ts
 * const recorder = new ɵAudioRecorder();
 * await recorder.start();
 * const blob = await recorder.stop();
 * recorder.dispose(); // on unmount
 * ```
 */
export class ɵAudioRecorder {
  private state: ɵAudioRecorderState = "idle";
  private readonly listeners = new Set<() => void>();
  private starting = false;
  private disposed = false;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  /** The current state. */
  getSnapshot = () => this.state;

  /** Calls `listener` when the state changes. Returns an unsubscribe. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The analyser of the live microphone signal, while recording. */
  getAnalyser() {
    return this.analyser;
  }

  /**
   * Ask for the microphone and start recording.
   *
   * @throws {ɵAudioRecorderError} When the recorder is already starting or
   *   active, the user denies the microphone, there is no microphone, or the
   *   browser cannot record. The recorder is then `"idle"` again.
   */
  async start() {
    if (this.starting || this.state !== "idle") {
      throw new ɵAudioRecorderError("Recorder is already active");
    }
    this.starting = true;
    this.disposed = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.stream = stream;
      if (this.disposed) {
        this.release();
        return;
      }

      const audioContext = new AudioContext();
      this.audioContext = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      this.analyser = analyser;

      const mimeType = pickMimeType();
      const mediaRecorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : {},
      );
      this.mediaRecorder = mediaRecorder;
      this.chunks = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      mediaRecorder.start(TIMESLICE_MS);
      this.setState("recording");
    } catch (error) {
      this.release();
      this.setState("idle");
      throw toRecorderError(error);
    } finally {
      this.starting = false;
    }
  }

  /**
   * Stop recording.
   *
   * @returns The recorded audio, typed with the recorder's format
   *   (`"audio/webm"` when the browser does not say).
   * @throws {ɵAudioRecorderError} When nothing records, or the browser
   *   reports a recording error.
   */
  stop() {
    return new Promise<Blob>((resolve, reject) => {
      const mediaRecorder = this.mediaRecorder;
      if (!mediaRecorder || this.state !== "recording") {
        reject(new ɵAudioRecorderError("No active recording"));
        return;
      }

      this.setState("processing");
      mediaRecorder.onstop = () => {
        const type = mediaRecorder.mimeType || "audio/webm";
        const blob = new Blob(this.chunks, { type });
        this.release();
        this.setState("idle");
        resolve(blob);
      };
      mediaRecorder.onerror = () => {
        this.release();
        this.setState("idle");
        reject(new ɵAudioRecorderError("Recording failed"));
      };
      mediaRecorder.stop();
    });
  }

  /**
   * Stop the microphone and release every resource. A recording in progress
   * is dropped. Safe to call more than once. Listeners stay subscribed, so a
   * framework can call it while its component stays mounted.
   */
  dispose() {
    this.disposed = true;
    this.release();
    this.setState("idle");
  }

  private setState(next: ɵAudioRecorderState) {
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private release() {
    const mediaRecorder = this.mediaRecorder;
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.onstop = null;
      mediaRecorder.onerror = null;
      try {
        mediaRecorder.stop();
      } catch {
        // The recorder can already be stopping.
      }
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    const audioContext = this.audioContext;
    if (audioContext && audioContext.state !== "closed") {
      audioContext.close().catch(() => {
        // A close that fails leaves nothing to clean up.
      });
    }
    this.mediaRecorder = null;
    this.stream = null;
    this.audioContext = null;
    this.analyser = null;
    this.chunks = [];
  }
}

/**
 * The root mean square level of time-domain samples from an analyser.
 *
 * @param samples - Bytes from `getByteTimeDomainData`, where `128` is silence.
 * @returns A level from `0` (silence) to about `1`. Normal speech is
 *   about `0` to `0.5`.
 */
export function ɵrmsAmplitude(samples: Uint8Array) {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const value of samples) {
    const sample = value / 128 - 1;
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}

/** Look of the scrolling waveform. */
const BAR_WIDTH = 2;
const BAR_GAP = 1;
const BAR_SPACING = BAR_WIDTH + BAR_GAP;
/** Pixels the waveform moves each frame. */
const SCROLL_SPEED = 1 / 3;
/** How fast the level follows a louder or a quieter signal. */
const ATTACK = 0.12;
const DECAY = 0.08;
/** How much the waveform fades in each frame. */
const FADE_STEP = 0.03;
/** The width, in pixels, of the fade at each edge. */
const EDGE_FADE_PX = 12;
/** RMS of speech is small; this scales it to the canvas height. */
const AMPLITUDE_SCALE = 4;

/**
 * Draw the recorder's live level as bars that scroll from right to left.
 *
 * The bars use the canvas's CSS `color`. They fade in when recording starts,
 * and the drawing clears when the recorder is `"idle"` again.
 *
 * @param canvas - The canvas to draw on. It is sized to its CSS box and the
 *   device pixel ratio.
 * @param recorder - The recorder whose level to draw.
 * @returns `dispose()`, which stops drawing.
 *
 * @example
 * ```ts
 * const waveform = ɵcreateWaveformRenderer(canvas, recorder);
 * waveform.dispose(); // on unmount
 * ```
 */
export function ɵcreateWaveformRenderer(
  canvas: HTMLCanvasElement,
  recorder: ɵAudioRecorder,
) {
  const context = canvas.getContext("2d");
  let frame: number | null = null;
  let history: number[] = [];
  let scrollOffset = 0;
  let smoothed = 0;
  let fade = 0;

  const reset = () => {
    history = [];
    scrollOffset = 0;
    smoothed = 0;
    fade = 0;
  };
  const unsubscribe = recorder.subscribe(() => {
    if (recorder.getSnapshot() === "idle") reset();
  });

  const sample = (analyser: AnalyserNode, maxBars: number) => {
    if (history.length === 0)
      history = Array.from({ length: maxBars }, () => 0);
    fade = Math.min(1, fade + FADE_STEP);
    scrollOffset += SCROLL_SPEED;

    const samples = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(samples);
    const level = ɵrmsAmplitude(samples);
    smoothed += (level - smoothed) * (level > smoothed ? ATTACK : DECAY);

    if (scrollOffset < BAR_SPACING) return;
    scrollOffset -= BAR_SPACING;
    history.push(smoothed);
    if (history.length > maxBars) history = history.slice(-maxBars);
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const isResized =
      canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr;
    if (isResized) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }

    const maxBars = Math.floor(rect.width / BAR_SPACING) + 2;
    const analyser = recorder.getAnalyser();
    if (analyser && recorder.getSnapshot() === "recording") {
      sample(analyser, maxBars);
    }

    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = window.getComputedStyle(canvas).color;
    ctx.globalAlpha = fade;

    const centerY = rect.height / 2;
    const maxAmplitude = rect.height / 2 - 2;
    for (const [index, amplitude] of history.entries()) {
      const scaled = Math.min(amplitude * AMPLITUDE_SCALE, 1);
      const barHeight = Math.max(2, scaled * maxAmplitude * 2);
      const x =
        rect.width - (history.length - index) * BAR_SPACING - scrollOffset;
      const isVisible = x + BAR_WIDTH > 0 && x < rect.width;
      if (!isVisible) continue;

      let edgeOpacity = 1;
      if (x < EDGE_FADE_PX) edgeOpacity = Math.max(0, x / EDGE_FADE_PX);
      else if (x > rect.width - EDGE_FADE_PX) {
        edgeOpacity = Math.max(0, (rect.width - x) / EDGE_FADE_PX);
      }
      ctx.globalAlpha = fade * edgeOpacity;
      ctx.fillRect(x, centerY - barHeight / 2, BAR_WIDTH, barHeight);
    }
  };

  const loop = () => {
    if (!context) return;
    draw(context);
    frame = requestAnimationFrame(loop);
  };
  loop();

  return {
    dispose() {
      unsubscribe();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    },
  };
}
