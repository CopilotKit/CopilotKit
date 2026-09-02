import { html, nothing } from "lit";
import type {
  ThreadsExampleOverviewVideoListeners,
  ThreadsState,
} from "../state.js";

const THREADS_EXAMPLE_OVERVIEW_VIDEO_URL =
  "https://cdn.copilotkit.ai/corp-site/videos/copilotkit-generative-ui-agentic-frontend-demo.webm";

const THREADS_EXAMPLE_OVERVIEW_VIDEO_FALLBACK =
  "The demo video is unavailable. Use the example threads to explore Messages, AG-UI Events, and State.";

export interface ThreadsExampleVideoEnvironment {
  state: ThreadsState;
  win: Window | null;
  isConnected: () => boolean;
  requestUpdate: () => void;
}

function cancelGate({ state, win }: ThreadsExampleVideoEnvironment): void {
  if (state.exampleOverviewVideoLoadTimer !== null) {
    win?.clearTimeout(state.exampleOverviewVideoLoadTimer);
    state.exampleOverviewVideoLoadTimer = null;
  }
  if (state.exampleOverviewVideoIdleCallbackId !== null) {
    win?.cancelIdleCallback?.(state.exampleOverviewVideoIdleCallbackId);
    state.exampleOverviewVideoIdleCallbackId = null;
  }
}

function isCurrent(
  environment: ThreadsExampleVideoEnvironment,
  video: HTMLVideoElement,
  lifecycleGeneration: number,
): boolean {
  const { state } = environment;
  return (
    environment.isConnected() &&
    video.isConnected &&
    state.exampleOverviewVideoElement === video &&
    state.exampleOverviewVideoLifecycleGeneration === lifecycleGeneration
  );
}

function invalidatePlay(state: ThreadsState): void {
  state.exampleOverviewVideoPlayAttemptGeneration += 1;
  state.exampleOverviewVideoPlayPromise = null;
}

function fail(
  environment: ThreadsExampleVideoEnvironment,
  video: HTMLVideoElement,
  lifecycleGeneration: number,
): void {
  if (!isCurrent(environment, video, lifecycleGeneration)) return;
  invalidatePlay(environment.state);
  environment.state.exampleOverviewVideoLoaded = false;
  environment.state.exampleOverviewVideoState = "failed";
  environment.requestUpdate();
}

async function settlePlay(
  environment: ThreadsExampleVideoEnvironment,
  video: HTMLVideoElement,
  lifecycleGeneration: number,
  playAttemptGeneration: number,
  playback: Promise<void>,
): Promise<void> {
  const { state } = environment;
  try {
    await playback;
    if (
      isCurrent(environment, video, lifecycleGeneration) &&
      state.exampleOverviewVideoPlayAttemptGeneration ===
        playAttemptGeneration &&
      state.exampleOverviewVideoState !== "failed"
    ) {
      state.exampleOverviewVideoState = "playing";
      environment.requestUpdate();
    }
  } catch {
    if (
      isCurrent(environment, video, lifecycleGeneration) &&
      state.exampleOverviewVideoPlayAttemptGeneration === playAttemptGeneration
    ) {
      fail(environment, video, lifecycleGeneration);
    }
  } finally {
    if (
      state.exampleOverviewVideoPlayAttemptGeneration === playAttemptGeneration
    ) {
      state.exampleOverviewVideoPlayPromise = null;
    }
  }
}

function play(
  environment: ThreadsExampleVideoEnvironment,
  video: HTMLVideoElement,
  lifecycleGeneration: number,
): void {
  const { state } = environment;
  if (
    state.exampleOverviewVideoPlayPromise !== null ||
    state.exampleOverviewVideoState === "deferred" ||
    state.exampleOverviewVideoState === "failed" ||
    !isCurrent(environment, video, lifecycleGeneration)
  ) {
    return;
  }

  const playAttemptGeneration =
    state.exampleOverviewVideoPlayAttemptGeneration + 1;
  state.exampleOverviewVideoPlayAttemptGeneration = playAttemptGeneration;
  try {
    const playback = Promise.resolve(video.play());
    state.exampleOverviewVideoPlayPromise = settlePlay(
      environment,
      video,
      lifecycleGeneration,
      playAttemptGeneration,
      playback,
    );
  } catch {
    fail(environment, video, lifecycleGeneration);
  }
}

function activate(
  environment: ThreadsExampleVideoEnvironment,
  video: HTMLVideoElement,
  lifecycleGeneration: number,
  shouldPlay: boolean,
): void {
  const { state } = environment;
  if (
    state.exampleOverviewVideoState !== "deferred" ||
    !isCurrent(environment, video, lifecycleGeneration)
  ) {
    return;
  }

  state.exampleOverviewVideoState = "ready";
  state.exampleOverviewVideoLoaded = false;
  video.autoplay = !state.exampleOverviewVideoReducedMotion;
  video.setAttribute("src", THREADS_EXAMPLE_OVERVIEW_VIDEO_URL);
  environment.requestUpdate();
  if (shouldPlay) play(environment, video, lifecycleGeneration);
}

function scheduleLoad(environment: ThreadsExampleVideoEnvironment): void {
  const { state, win } = environment;
  const video = state.exampleOverviewVideoElement;
  if (
    !video ||
    !environment.isConnected() ||
    state.exampleOverviewVideoState !== "deferred" ||
    state.exampleOverviewVideoLoadTimer !== null ||
    state.exampleOverviewVideoIdleCallbackId !== null ||
    !win
  ) {
    return;
  }

  const lifecycleGeneration = state.exampleOverviewVideoLifecycleGeneration;
  if (typeof win.requestIdleCallback === "function") {
    let idleCallbackId = 0;
    idleCallbackId = win.requestIdleCallback(
      () => {
        if (state.exampleOverviewVideoIdleCallbackId !== idleCallbackId) return;
        state.exampleOverviewVideoIdleCallbackId = null;
        activate(
          environment,
          video,
          lifecycleGeneration,
          !state.exampleOverviewVideoReducedMotion,
        );
      },
      { timeout: 1200 },
    );
    state.exampleOverviewVideoIdleCallbackId = idleCallbackId;
    return;
  }

  const loadTimer = win.setTimeout(() => {
    if (state.exampleOverviewVideoLoadTimer !== loadTimer) return;
    state.exampleOverviewVideoLoadTimer = null;
    activate(
      environment,
      video,
      lifecycleGeneration,
      !state.exampleOverviewVideoReducedMotion,
    );
  }, 450);
  state.exampleOverviewVideoLoadTimer = loadTimer;
}

function bind(
  environment: ThreadsExampleVideoEnvironment,
  video: HTMLVideoElement,
): void {
  const { state } = environment;
  const lifecycleGeneration = state.exampleOverviewVideoLifecycleGeneration;
  const listeners: ThreadsExampleOverviewVideoListeners = {
    loadeddata: () => {
      if (
        !isCurrent(environment, video, lifecycleGeneration) ||
        state.exampleOverviewVideoState === "deferred" ||
        state.exampleOverviewVideoState === "failed"
      ) {
        return;
      }
      state.exampleOverviewVideoLoaded = true;
      environment.requestUpdate();
    },
    play: () => {
      if (
        isCurrent(environment, video, lifecycleGeneration) &&
        state.exampleOverviewVideoState !== "deferred" &&
        state.exampleOverviewVideoState !== "failed"
      ) {
        state.exampleOverviewVideoState = "playing";
        environment.requestUpdate();
      }
    },
    pause: () => {
      if (
        isCurrent(environment, video, lifecycleGeneration) &&
        state.exampleOverviewVideoState !== "deferred" &&
        state.exampleOverviewVideoState !== "failed"
      ) {
        invalidatePlay(state);
        state.exampleOverviewVideoState = "ready";
        environment.requestUpdate();
      }
    },
    error: () => fail(environment, video, lifecycleGeneration),
  };
  state.exampleOverviewVideoElement = video;
  state.exampleOverviewVideoListeners = listeners;
  video.addEventListener("loadeddata", listeners.loadeddata);
  video.addEventListener("play", listeners.play);
  video.addEventListener("pause", listeners.pause);
  video.addEventListener("error", listeners.error);
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.autoplay =
    state.exampleOverviewVideoState !== "deferred" &&
    !state.exampleOverviewVideoReducedMotion;
}

export function cleanupThreadsExampleVideo(
  environment: ThreadsExampleVideoEnvironment,
): void {
  const { state } = environment;
  const video = state.exampleOverviewVideoElement;
  if (video) state.exampleOverviewVideoLifecycleGeneration += 1;
  invalidatePlay(state);
  cancelGate(environment);
  state.exampleOverviewVideoPlayOnNextBind = false;

  const listeners = state.exampleOverviewVideoListeners;
  if (video && listeners) {
    video.removeEventListener("loadeddata", listeners.loadeddata);
    video.removeEventListener("play", listeners.play);
    video.removeEventListener("pause", listeners.pause);
    video.removeEventListener("error", listeners.error);
  }
  state.exampleOverviewVideoElement = null;
  state.exampleOverviewVideoListeners = null;

  if (video) {
    try {
      video.pause();
    } catch {
      // Some DOM shims expose media methods that throw instead of no-oping.
    }
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      // Cleanup must stay synchronous and never surface media abort errors.
    }
  }
  state.exampleOverviewVideoLoaded = false;
  state.exampleOverviewVideoState = "deferred";
}

export function reconcileThreadsExampleVideo(
  environment: ThreadsExampleVideoEnvironment,
  video: HTMLVideoElement | null,
): void {
  const { state } = environment;
  if (!video) {
    if (
      state.exampleOverviewVideoElement ||
      state.exampleOverviewVideoState !== "deferred" ||
      state.exampleOverviewVideoLoadTimer !== null ||
      state.exampleOverviewVideoIdleCallbackId !== null ||
      state.exampleOverviewVideoPlayOnNextBind
    ) {
      cleanupThreadsExampleVideo(environment);
    }
    return;
  }

  if (state.exampleOverviewVideoElement !== video) {
    if (state.exampleOverviewVideoElement) {
      cleanupThreadsExampleVideo(environment);
    }
    bind(environment, video);
  }
  if (state.exampleOverviewVideoPlayOnNextBind) {
    state.exampleOverviewVideoPlayOnNextBind = false;
    activate(
      environment,
      video,
      state.exampleOverviewVideoLifecycleGeneration,
      true,
    );
    return;
  }
  scheduleLoad(environment);
}

export function controlThreadsExampleVideo(
  environment: ThreadsExampleVideoEnvironment,
): void {
  const { state } = environment;
  const video = state.exampleOverviewVideoElement;
  if (!video) return;

  if (state.exampleOverviewVideoState === "playing") {
    invalidatePlay(state);
    try {
      video.pause();
    } catch {
      // Keep the visible state usable when a media shim cannot pause.
    }
    state.exampleOverviewVideoState = "ready";
    environment.requestUpdate();
    return;
  }

  if (state.exampleOverviewVideoState === "failed") {
    cleanupThreadsExampleVideo(environment);
    if (!environment.isConnected() || !video.isConnected) return;
    state.exampleOverviewVideoPlayOnNextBind = true;
    environment.requestUpdate();
    return;
  }

  cancelGate(environment);
  const lifecycleGeneration = state.exampleOverviewVideoLifecycleGeneration;
  if (state.exampleOverviewVideoState === "deferred") {
    activate(environment, video, lifecycleGeneration, true);
    return;
  }
  play(environment, video, lifecycleGeneration);
}

export function renderThreadsExampleVideo(
  state: ThreadsState,
  onControl: () => void,
) {
  const isPlaying = state.exampleOverviewVideoState === "playing";
  const sourceIsAttached = state.exampleOverviewVideoState !== "deferred";
  const video = html`<video
    class="cpk-threads-overview-video"
    data-loaded=${state.exampleOverviewVideoLoaded}
    ?autoplay=${sourceIsAttached && !state.exampleOverviewVideoReducedMotion}
    .autoplay=${sourceIsAttached && !state.exampleOverviewVideoReducedMotion}
    loop
    .loop=${true}
    muted
    .muted=${true}
    playsinline
    .playsInline=${true}
    preload="metadata"
  ></video>`;
  const generationScopedVideo =
    state.exampleOverviewVideoLifecycleGeneration % 2 === 0
      ? html`<!-- cpk-video-generation-even -->${video}`
      : html`<!-- cpk-video-generation-odd -->${video}`;
  return html`
    <div class="cpk-threads-overview-video-frame" aria-hidden="true">
      ${generationScopedVideo}
    </div>
    <button
      class="cpk-threads-overview-video-control"
      type="button"
      aria-pressed=${isPlaying ? "false" : "true"}
      @click=${onControl}
    >
      ${isPlaying ? "Pause demo" : "Play demo"}
    </button>
    ${
      state.exampleOverviewVideoState === "failed"
        ? html`<p class="cpk-threads-overview-video-fallback" role="status">
          ${THREADS_EXAMPLE_OVERVIEW_VIDEO_FALLBACK}
        </p>`
        : nothing
    }
  `;
}
