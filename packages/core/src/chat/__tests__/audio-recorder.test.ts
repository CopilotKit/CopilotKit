// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ɵAudioRecorder,
  ɵAudioRecorderError,
  ɵcreateWaveformRenderer,
  ɵrmsAmplitude,
} from "../audio-recorder";

// --- Browser media fakes (the boundary the recorder talks to) -------------

interface FakeTrack {
  stopped: boolean;
  stop: () => void;
}

function createStream() {
  const track: FakeTrack = {
    stopped: false,
    stop() {
      track.stopped = true;
    },
  };
  return { track, stream: { getTracks: () => [track] } };
}

let supportedTypes: string[] = [];
let recorders: FakeMediaRecorder[] = [];
/** The bytes every analyser reports. */
let analyserBytes = new Uint8Array([128]);

class FakeMediaRecorder {
  static isTypeSupported(type: string) {
    return supportedTypes.includes(type);
  }
  state: "inactive" | "recording" = "inactive";
  timeslice: number | undefined;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly mimeType: string;
  constructor(
    readonly stream: unknown,
    readonly options: { mimeType?: string },
  ) {
    this.mimeType = options.mimeType ?? "";
    recorders.push(this);
  }
  start(timeslice: number) {
    this.state = "recording";
    this.timeslice = timeslice;
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["abc"]) });
      this.onstop?.();
    });
  }
  fail() {
    this.onerror?.();
  }
}

class FakeAudioContext {
  state = "running";
  createAnalyser() {
    return {
      fftSize: 0,
      getByteTimeDomainData(target: Uint8Array) {
        target.set(analyserBytes.subarray(0, target.length));
        target.fill(analyserBytes[0] ?? 128, analyserBytes.length);
      },
    };
  }
  createMediaStreamSource() {
    return { connect: () => {} };
  }
  close() {
    this.state = "closed";
    return Promise.resolve();
  }
}

function stubMedia(getUserMedia: () => Promise<unknown>) {
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
}

function namedError(name: string) {
  const error = new Error(name);
  error.name = name;
  return error;
}

beforeEach(() => {
  supportedTypes = ["audio/webm", "audio/mp4"];
  recorders = [];
  analyserBytes = new Uint8Array([128]);
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function startRecording() {
  const { stream, track } = createStream();
  stubMedia(() => Promise.resolve(stream));
  const recorder = new ɵAudioRecorder();
  await recorder.start();
  const mediaRecorder = recorders[0]!;
  return { recorder, track, mediaRecorder };
}

describe("ɵAudioRecorder", () => {
  it("records with the first supported format in 100ms chunks", async () => {
    const { recorder, mediaRecorder } = await startRecording();

    expect(recorder.getSnapshot()).toBe("recording");
    expect(mediaRecorder.options).toEqual({ mimeType: "audio/webm" });
    expect(mediaRecorder.timeslice).toBe(100);
    expect(recorder.getAnalyser()?.fftSize).toBe(2048);
  });

  it("records without a format when the browser supports none of ours", async () => {
    supportedTypes = [];
    const { mediaRecorder } = await startRecording();
    expect(mediaRecorder.options).toEqual({});
  });

  it("stops with a blob of the chunks and releases the microphone", async () => {
    const { recorder, track } = await startRecording();
    const states: string[] = [];
    recorder.subscribe(() => states.push(recorder.getSnapshot()));

    const blob = await recorder.stop();

    expect(await blob.text()).toBe("abc");
    expect(blob.type).toBe("audio/webm");
    expect(states).toEqual(["processing", "idle"]);
    expect(track.stopped).toBe(true);
    expect(recorder.getAnalyser()).toBeNull();
  });

  it("types the blob audio/webm when the browser gives no format", async () => {
    supportedTypes = [];
    const { recorder } = await startRecording();
    const blob = await recorder.stop();
    expect(blob.type).toBe("audio/webm");
  });

  it("rejects a second start while recording", async () => {
    const { recorder } = await startRecording();
    await expect(recorder.start()).rejects.toThrow(
      new ɵAudioRecorderError("Recorder is already active"),
    );
  });

  it("rejects a second start while the first waits for the microphone", async () => {
    const { stream } = createStream();
    let grant!: (value: unknown) => void;
    stubMedia(() => new Promise((resolve) => (grant = resolve)));
    const recorder = new ɵAudioRecorder();

    const first = recorder.start();
    await expect(recorder.start()).rejects.toThrow(
      "Recorder is already active",
    );
    grant(stream);
    await first;

    expect(recorders).toHaveLength(1);
  });

  it.each([
    { name: "NotAllowedError", message: "Microphone permission denied" },
    { name: "NotFoundError", message: "No microphone found" },
    { name: "NotReadableError", message: "NotReadableError" },
  ])(
    "maps $name to $message and goes back to idle",
    async ({ name, message }) => {
      stubMedia(() => Promise.reject(namedError(name)));
      const recorder = new ɵAudioRecorder();

      const error = await recorder.start().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ɵAudioRecorderError);
      expect(error).toMatchObject({ name: "AudioRecorderError", message });
      expect(recorder.getSnapshot()).toBe("idle");
    },
  );

  it("reports a generic message for a failure that is not an Error", async () => {
    stubMedia(() => Promise.reject("nope"));
    await expect(new ɵAudioRecorder().start()).rejects.toThrow(
      "Failed to start recording",
    );
  });

  it("rejects stop when nothing records", async () => {
    await expect(new ɵAudioRecorder().stop()).rejects.toThrow(
      "No active recording",
    );
  });

  it("rejects stop and goes idle when the browser reports a recording error", async () => {
    const { recorder, mediaRecorder } = await startRecording();
    mediaRecorder.stop = () => {
      mediaRecorder.state = "inactive";
      queueMicrotask(() => mediaRecorder.fail());
    };

    await expect(recorder.stop()).rejects.toThrow("Recording failed");
    expect(recorder.getSnapshot()).toBe("idle");
  });

  it("drops the microphone when disposed while it waits for permission", async () => {
    const { stream, track } = createStream();
    let grant!: (value: unknown) => void;
    stubMedia(() => new Promise((resolve) => (grant = resolve)));
    const recorder = new ɵAudioRecorder();

    const starting = recorder.start();
    recorder.dispose();
    grant(stream);
    await starting;

    expect(track.stopped).toBe(true);
    expect(recorder.getSnapshot()).toBe("idle");
    expect(recorders).toHaveLength(0);
  });

  it("goes idle and releases the microphone on dispose while recording", async () => {
    const { recorder, track } = await startRecording();
    recorder.dispose();
    expect(recorder.getSnapshot()).toBe("idle");
    expect(track.stopped).toBe(true);
  });
});

describe("ɵrmsAmplitude", () => {
  it.each([
    { samples: [128, 128], expected: 0 },
    { samples: [64, 192], expected: 0.5 },
    { samples: [0, 0], expected: 1 },
    { samples: [], expected: 0 },
  ])("is $expected for $samples", ({ samples, expected }) => {
    expect(ɵrmsAmplitude(new Uint8Array(samples))).toBeCloseTo(expected);
  });
});

describe("ɵcreateWaveformRenderer", () => {
  let frames: FrameRequestCallback[] = [];

  function createCanvas() {
    const bars: number[][] = [];
    const context = {
      fillStyle: "",
      globalAlpha: 1,
      scale: () => {},
      clearRect: () => {
        bars.push([]);
      },
      fillRect: (_x: number, _y: number, _width: number, height: number) => {
        bars[bars.length - 1]!.push(height);
      },
    };
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D, // A partial 2D context: the renderer calls only these members.
    );
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ width: 30, height: 20 }),
    );
    return { canvas, lastFrameBars: () => bars[bars.length - 1] ?? [] };
  }

  function runFrames(count: number) {
    for (let index = 0; index < count; index += 1) {
      const pending = frames;
      frames = [];
      for (const frame of pending) frame(0);
    }
  }

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      frames = [];
    });
  });

  it("draws nothing while the recorder is idle", () => {
    const { canvas, lastFrameBars } = createCanvas();
    ɵcreateWaveformRenderer(canvas, new ɵAudioRecorder());
    runFrames(5);
    expect(lastFrameBars()).toEqual([]);
  });

  it("draws taller bars for a loud signal and clears when the recording ends", async () => {
    analyserBytes = new Uint8Array([0]);
    const { recorder } = await startRecording();
    const { canvas, lastFrameBars } = createCanvas();
    ɵcreateWaveformRenderer(canvas, recorder);

    runFrames(30);
    // A 30px canvas holds 12 bars; the 20px height allows 16px bars at most.
    expect(lastFrameBars().length).toBeGreaterThan(0);
    expect(Math.max(...lastFrameBars())).toBe(16);

    await recorder.stop();
    runFrames(1);
    expect(lastFrameBars()).toEqual([]);
  });

  it("stops drawing after dispose", () => {
    const { canvas } = createCanvas();
    const waveform = ɵcreateWaveformRenderer(canvas, new ɵAudioRecorder());
    waveform.dispose();
    expect(frames).toHaveLength(0);
  });
});
