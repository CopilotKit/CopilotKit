import { A2uiRendererService } from "@a2ui/angular/v0_9";
import { EnvironmentInjector, InjectionToken, inject } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";
import { registerA2UIActionHandlers } from "../a2ui-angular-action-handlers";
import { provideA2UIAngularRenderer } from "../provide-a2ui-angular-renderer";

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

const GREETING = new InjectionToken<string>("GREETING", {
  factory: () => "hello",
});

function createSurface(renderer: A2uiRendererService, surfaceId: string) {
  renderer.processMessages([
    {
      version: "v0.9",
      createSurface: { surfaceId, catalogId: BASIC_CATALOG_ID },
    },
  ]);
  const surface = renderer.surfaceGroup.getSurface(surfaceId);
  if (!surface) {
    throw new Error(`Surface '${surfaceId}' was not created.`);
  }
  return surface;
}

describe("registerA2UIActionHandlers", () => {
  it("routes dispatched actions to the handler registered under the action name", async () => {
    TestBed.configureTestingModule({
      providers: [provideA2UIAngularRenderer()],
    });
    const renderer = TestBed.inject(A2uiRendererService);
    const bookFlight = vi.fn();

    TestBed.runInInjectionContext(() =>
      registerA2UIActionHandlers({ bookFlight }),
    );

    const surface = createSurface(renderer, "surf-a");
    await surface.dispatchAction(
      { event: { name: "bookFlight", context: { flightId: 42 } } },
      "btn-1",
    );

    expect(bookFlight).toHaveBeenCalledTimes(1);
    expect(bookFlight).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "bookFlight",
        surfaceId: "surf-a",
        sourceComponentId: "btn-1",
        context: { flightId: 42 },
      }),
    );
  });

  it("ignores actions without a registered handler", async () => {
    TestBed.configureTestingModule({
      providers: [provideA2UIAngularRenderer()],
    });
    const renderer = TestBed.inject(A2uiRendererService);
    const bookFlight = vi.fn();

    TestBed.runInInjectionContext(() =>
      registerA2UIActionHandlers({ bookFlight }),
    );

    const surface = createSurface(renderer, "surf-b");
    await surface.dispatchAction(
      { event: { name: "unknownAction", context: {} } },
      "btn-1",
    );

    expect(bookFlight).not.toHaveBeenCalled();
  });

  it("runs handlers in the environment injection context", async () => {
    TestBed.configureTestingModule({
      providers: [provideA2UIAngularRenderer()],
    });
    const renderer = TestBed.inject(A2uiRendererService);
    let injected: string | undefined;

    TestBed.runInInjectionContext(() =>
      registerA2UIActionHandlers({
        greet: () => {
          injected = inject(GREETING);
        },
      }),
    );

    const surface = createSurface(renderer, "surf-c");
    await surface.dispatchAction(
      { event: { name: "greet", context: {} } },
      "btn-1",
    );

    expect(injected).toBe("hello");
  });

  it("stops handling actions when the injection context is destroyed", async () => {
    TestBed.configureTestingModule({
      providers: [provideA2UIAngularRenderer()],
    });
    const renderer = TestBed.inject(A2uiRendererService);
    const bookFlight = vi.fn();

    TestBed.runInInjectionContext(() =>
      registerA2UIActionHandlers({ bookFlight }),
    );
    const surface = createSurface(renderer, "surf-d");

    TestBed.inject(EnvironmentInjector).destroy();
    await surface.dispatchAction(
      { event: { name: "bookFlight", context: {} } },
      "btn-1",
    );

    expect(bookFlight).not.toHaveBeenCalled();
  });
});
