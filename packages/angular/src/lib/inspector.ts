import { ANGULAR_SDK_VERSION } from "./package-version";
import { DOCUMENT, isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  DestroyRef,
  Injectable,
  InjectionToken,
  Injector,
  PLATFORM_ID,
  inject,
  isDevMode,
  signal,
} from "@angular/core";
import { shouldEnableInspector } from "@copilotkit/shared";
import { ɵmountInspector } from "@copilotkit/web-inspector/mount";
import type { ɵInspectorMount } from "@copilotkit/web-inspector/mount";

import { COPILOT_KIT_CONFIG, type CopilotKitConfig } from "./config";
import { CopilotKit } from "./copilotkit";

/**
 * Injection token that reports whether the Inspector treats the app as
 * development. Tests can override it. Applications must not depend on it.
 *
 * @internal
 */
export const ɵCOPILOTKIT_INSPECTOR_DEVELOPMENT_MODE =
  new InjectionToken<boolean>("CopilotKit Inspector development mode", {
    factory: isDevMode,
  });

export type AngularInspectorOpenRequest = {
  messageId: string;
  threadId?: string;
  agentId?: string;
};

@Injectable({ providedIn: "root" })
export class CopilotInspector {
  private readonly config = inject<CopilotKitConfig | null>(
    COPILOT_KIT_CONFIG,
    { optional: true },
  );
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isDevelopment = inject(
    ɵCOPILOTKIT_INSPECTOR_DEVELOPMENT_MODE,
  );
  readonly #visible = signal(false);
  #mount: ɵInspectorMount | null = null;
  #pendingRequest: AngularInspectorOpenRequest | null = null;
  #destroyed = false;

  readonly shouldRenderInspector = shouldEnableInspector({
    enableInspector: this.config?.enableInspector,
    isBrowser: isPlatformBrowser(this.platformId),
    isDevelopment: this.isDevelopment,
    hostname: this.document.defaultView?.location.hostname,
  });

  /**
   * Whether Inspector-backed message actions should be shown: the Inspector
   * is mounted and not hidden by a dismissal. Reads a signal, so a `computed`
   * that reads it follows Inspector visibility.
   */
  get isInspectorEnabled() {
    return this.shouldRenderInspector && this.#visible();
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.#destroyed = true;
      this.#mount?.dispose();
      this.#mount = null;
    });

    if (this.shouldRenderInspector) {
      afterNextRender(() => this.#mountInspector());
    }
  }

  /** Opens the Inspector at a message. A request made before it loads opens once it is ready. */
  openInspector(request: AngularInspectorOpenRequest): void {
    if (this.#mount) {
      this.#mount.open(request);
      return;
    }
    this.#pendingRequest = request;
  }

  #mountInspector(): void {
    if (this.#destroyed) return;
    const mount = ɵmountInspector(
      this.document.body,
      this.injector.get(CopilotKit).core,
      {
        load: () => import("@copilotkit/web-inspector"),
        notificationContext: {
          development: this.isDevelopment,
          framework: "angular",
          sdkVersion: ANGULAR_SDK_VERSION,
        },
      },
    );
    mount.onVisibility((visible) => this.#visible.set(visible));
    if (this.#pendingRequest) mount.open(this.#pendingRequest);
    this.#pendingRequest = null;
    this.#mount = mount;
  }
}
