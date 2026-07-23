import { vi } from "vitest";

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

class MockMediaRecorder {
  static isTypeSupported() {
    return true;
  }

  public state: RecordingState = "inactive";
  public mimeType = "audio/webm";
  public ondataavailable: ((event: BlobEvent) => void) | null = null;
  public onstop: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, Set<(...args: any[]) => void>>();

  constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {
    void _stream;
    void _options;
  }

  addEventListener(type: string, listener: (...args: any[]) => void) {
    const existing = this.listeners.get(type) ?? new Set();
    existing.add(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener(type: string, listener: (...args: any[]) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  private dispatch(type: string, ...args: any[]) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(...args);
    }
  }

  start() {
    this.state = "recording";
  }

  stop() {
    if (this.state !== "recording") {
      return;
    }
    this.state = "inactive";
    const dataEvent = {
      data: new Blob(["mock-audio"], { type: this.mimeType }),
    } as BlobEvent;
    this.ondataavailable?.(dataEvent);
    this.dispatch("dataavailable", dataEvent);
    this.onstop?.();
    this.dispatch("stop");
  }
}

class MockAudioContext {
  public state: AudioContextState = "running";

  createMediaStreamSource() {
    return {
      connect: vi.fn(),
    };
  }

  createAnalyser() {
    return {
      fftSize: 2048,
      getByteTimeDomainData: (target: Uint8Array) => {
        target.fill(128);
      },
    };
  }

  close() {
    this.state = "closed";
    return Promise.resolve();
  }
}

if (typeof window !== "undefined") {
  if (!window.ResizeObserver) {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
  }

  if (!window.MediaRecorder) {
    vi.stubGlobal(
      "MediaRecorder",
      MockMediaRecorder as unknown as typeof MediaRecorder,
    );
  }

  if (!window.AudioContext) {
    vi.stubGlobal(
      "AudioContext",
      MockAudioContext as unknown as typeof AudioContext,
    );
  }

  if (!window.navigator.mediaDevices) {
    Object.defineProperty(window.navigator, "mediaDevices", {
      value: {},
      configurable: true,
    });
  }

  if (typeof window.navigator.mediaDevices.getUserMedia !== "function") {
    window.navigator.mediaDevices.getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop: vi.fn() }],
    })) as typeof window.navigator.mediaDevices.getUserMedia;
  }

  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: vi.fn(() => ({
      scale: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "#000",
      globalAlpha: 1,
    })),
  });
}
