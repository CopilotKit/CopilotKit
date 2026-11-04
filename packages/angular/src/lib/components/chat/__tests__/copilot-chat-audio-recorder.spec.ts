import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotChatAudioRecorder } from "../copilot-chat-audio-recorder";
import { AudioRecorderError } from "../copilot-chat-input.types";

// Browser media fakes: the boundary the recorder talks to.
class FakeMediaRecorder {
  static isTypeSupported() {
    return true;
  }
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => this.onstop?.());
  }
}

class FakeAudioContext {
  state = "running";
  createAnalyser() {
    return { fftSize: 0, getByteTimeDomainData: () => {} };
  }
  createMediaStreamSource() {
    return { connect: () => {} };
  }
  close() {
    return Promise.resolve();
  }
}

function render() {
  const fixture = TestBed.createComponent(CopilotChatAudioRecorder);
  fixture.detectChanges();
  const recorder = fixture.componentInstance;
  const errors: AudioRecorderError[] = [];
  const states: string[] = [];
  recorder.error.subscribe((error) => errors.push(error));
  recorder.stateChange.subscribe((state) => states.push(state));
  return { fixture, recorder, errors, states };
}

describe("CopilotChatAudioRecorder", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: () => Promise.resolve({ getTracks: () => [] }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it("records and reports each state", async () => {
    const { recorder, states } = render();
    await recorder.start();
    const blob = await recorder.stop();

    expect(blob.type).toBe("audio/webm");
    expect(states).toEqual(["recording", "processing", "idle"]);
    expect(recorder.getState()).toBe("idle");
  });

  it("rejects a second start while recording and emits the error", async () => {
    const { recorder, errors } = render();
    await recorder.start();

    await expect(recorder.start()).rejects.toThrow(
      "Recorder is already active",
    );
    expect(errors.map((error) => error.message)).toEqual([
      "Recorder is already active",
    ]);
    expect(errors[0]).toBeInstanceOf(AudioRecorderError);
  });

  it("emits the error when stop is called with nothing recording", async () => {
    const { recorder, errors } = render();
    await expect(recorder.stop()).rejects.toThrow("No active recording");
    expect(errors.map((error) => error.message)).toEqual([
      "No active recording",
    ]);
  });
});
