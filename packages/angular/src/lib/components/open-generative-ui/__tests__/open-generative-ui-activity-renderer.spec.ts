import type { ComponentFixture } from "@angular/core/testing";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CopilotOpenGenerativeUIActivityRenderer,
  CopilotOpenGenerativeUIRenderer,
  OPEN_GENERATIVE_UI_WEBSANDBOX_LOADER,
} from "../open-generative-ui-activity-renderer";
import { COPILOT_KIT_CONFIG } from "../../../config";
import type { OpenGenerativeUIContent } from "../../../open-generative-ui";

const mockRun = vi.fn().mockResolvedValue(undefined);
const mockDestroy = vi.fn();
let mockCreate: ReturnType<typeof vi.fn>;
let mockLoadWebsandbox: ReturnType<typeof vi.fn>;

function createSandbox(frameContainer?: HTMLElement) {
  const iframe = document.createElement("iframe");
  frameContainer?.appendChild(iframe);
  return {
    iframe,
    promise: Promise.resolve(),
    run: mockRun,
    destroy: () => {
      mockDestroy();
      iframe.remove();
    },
  };
}

async function flushSandboxImport(fixture: ComponentFixture<unknown>) {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

function setContent(
  fixture: ComponentFixture<CopilotOpenGenerativeUIRenderer>,
  content: OpenGenerativeUIContent,
) {
  fixture.componentRef.setInput("content", content);
  fixture.detectChanges();
}

describe("CopilotOpenGenerativeUIRenderer", () => {
  let fixture: ComponentFixture<CopilotOpenGenerativeUIRenderer>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate = vi.fn(
      (_localApi: unknown, options: { frameContainer: HTMLElement }) =>
        createSandbox(options.frameContainer),
    );
    mockLoadWebsandbox = vi.fn().mockResolvedValue({ create: mockCreate });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CopilotOpenGenerativeUIRenderer],
      providers: [
        {
          provide: COPILOT_KIT_CONFIG,
          useValue: {
            openGenerativeUI: {
              sandboxFunctions: [
                {
                  name: "setTheme",
                  description: "Set the host theme",
                  parameters: z.object({ theme: z.string() }),
                  handler: vi.fn(),
                },
              ],
            },
          },
        },
        {
          provide: OPEN_GENERATIVE_UI_WEBSANDBOX_LOADER,
          useValue: mockLoadWebsandbox,
        },
      ],
    });

    fixture = TestBed.createComponent(CopilotOpenGenerativeUIRenderer);
  });

  afterEach(() => {
    fixture.destroy();
  });

  it("renders the same placeholder shell while no sandbox is visible", async () => {
    setContent(fixture, { initialHeight: 300 });
    await flushSandboxImport(fixture);

    const container = fixture.nativeElement.querySelector(
      '[data-testid="open-generative-ui-renderer"]',
    ) as HTMLElement;

    expect(container.style.height).toBe("300px");
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="open-generative-ui-placeholder"]',
      ),
    ).not.toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates a preview sandbox when styled HTML is streaming", async () => {
    setContent(fixture, {
      css: ".metric { color: red; }",
      cssComplete: true,
      html: ['<body><div class="metric">Revenue'],
      htmlComplete: false,
    });
    await flushSandboxImport(fixture);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [, options] = mockCreate.mock.calls[0];
    expect(options.frameContent).toBe("<head></head><body></body>");
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="open-generative-ui-preview-sandbox"]',
      ),
    ).not.toBeNull();
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining("document.body.innerHTML"),
    );
  });

  it("keeps the placeholder until CSS is complete", async () => {
    setContent(fixture, {
      cssComplete: false,
      html: ['<body><div class="metric">Revenue'],
      htmlComplete: false,
    });
    await flushSandboxImport(fixture);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="open-generative-ui-placeholder"]',
      ),
    ).not.toBeNull();
  });

  it("does not create a preview after its sandbox loader becomes stale", async () => {
    let resolveLoader!: (value: { create: typeof mockCreate }) => void;
    mockLoadWebsandbox.mockReturnValue(
      new Promise((resolve) => {
        resolveLoader = resolve;
      }),
    );
    setContent(fixture, {
      cssComplete: true,
      html: ["<body><p>Old preview"],
      htmlComplete: false,
    });
    await flushSandboxImport(fixture);

    setContent(fixture, { generating: true });
    resolveLoader({ create: mockCreate });
    await flushSandboxImport(fixture);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="open-generative-ui-preview-sandbox"]',
      ),
    ).toBeNull();
  });

  it("creates a final sandbox when HTML is complete", async () => {
    setContent(fixture, {
      css: ".metric { color: blue; }",
      cssComplete: true,
      html: ["<body><p>Hello</p></body>"],
      htmlComplete: true,
    });
    await flushSandboxImport(fixture);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [localApi, options] = mockCreate.mock.calls[0];
    expect(Object.keys(localApi)).toEqual(["setTheme"]);
    expect(options.frameContent).toContain("<head>");
    expect(options.frameContent).toContain(
      "<style>.metric { color: blue; }</style>",
    );
    expect(options.frameContent).toContain("<body><p>Hello</p></body>");
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="open-generative-ui-final-sandbox"]',
      ),
    ).not.toBeNull();
  });

  it("destroys the preview sandbox when final HTML arrives", async () => {
    setContent(fixture, {
      css: ".metric { color: red; }",
      cssComplete: true,
      html: ['<body><div class="metric">Revenue'],
      htmlComplete: false,
    });
    await flushSandboxImport(fixture);

    setContent(fixture, {
      css: ".metric { color: red; }",
      cssComplete: true,
      html: ['<body><div class="metric">Revenue</div></body>'],
      htmlComplete: true,
    });
    await flushSandboxImport(fixture);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockDestroy).toHaveBeenCalled();
  });

  it("queues JS functions and expressions into the final sandbox", async () => {
    setContent(fixture, {
      html: ["<body><div id='app'></div></body>"],
      htmlComplete: true,
      jsFunctions: "function paint() { return true; }",
      jsExpressions: ["paint()", "document.body.dataset.ready = 'true'"],
    });
    await flushSandboxImport(fixture);

    expect(mockRun).toHaveBeenCalledWith("function paint() { return true; }");
    expect(mockRun).toHaveBeenCalledWith("paint()");
    expect(mockRun).toHaveBeenCalledWith(
      "document.body.dataset.ready = 'true'",
    );
  });

  it("injects JS that arrived before final HTML into the final sandbox", async () => {
    setContent(fixture, {
      jsFunctions: "function paintEarly() { return true; }",
      jsExpressions: ["paintEarly()"],
    });
    await flushSandboxImport(fixture);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalledWith(
      "function paintEarly() { return true; }",
    );

    setContent(fixture, {
      html: ["<body><div id='app'></div></body>"],
      htmlComplete: true,
      jsFunctions: "function paintEarly() { return true; }",
      jsExpressions: ["paintEarly()"],
    });
    await flushSandboxImport(fixture);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledWith(
      "function paintEarly() { return true; }",
    );
    expect(mockRun).toHaveBeenCalledWith("paintEarly()");
  });

  it("does not recreate the final sandbox when only expressions grow", async () => {
    const html = ["<body><div id='app'></div></body>"];
    setContent(fixture, {
      html,
      htmlComplete: true,
      jsExpressions: ["document.body.dataset.step = 'one'"],
    });
    await flushSandboxImport(fixture);

    expect(mockCreate).toHaveBeenCalledTimes(1);

    setContent(fixture, {
      html,
      htmlComplete: true,
      jsExpressions: [
        "document.body.dataset.step = 'one'",
        "document.body.dataset.step = 'two'",
      ],
    });
    await flushSandboxImport(fixture);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledWith("document.body.dataset.step = 'two'");
  });

  it("measures the final sandbox height once, even after later content updates", async () => {
    const measureCallCount = () =>
      mockRun.mock.calls.filter(
        ([code]) => typeof code === "string" && code.includes("__ck_resize"),
      ).length;

    setContent(fixture, {
      html: ["<body><p>Chart</p></body>"],
      htmlComplete: true,
      generating: true,
    });
    await flushSandboxImport(fixture);
    expect(measureCallCount()).toBe(0);

    setContent(fixture, {
      html: ["<body><p>Chart</p></body>"],
      htmlComplete: true,
      generating: false,
    });
    await flushSandboxImport(fixture);
    expect(measureCallCount()).toBe(1);

    setContent(fixture, {
      html: ["<body><p>Chart</p></body>"],
      htmlComplete: true,
      generating: false,
      initialHeight: 321,
    });
    await flushSandboxImport(fixture);
    expect(measureCallCount()).toBe(1);
  });

  it("tears down a completed sandbox immediately when a fresh generation starts", async () => {
    setContent(fixture, {
      css: ".dashboard { color: blue; }",
      cssComplete: true,
      html: ['<body><main class="dashboard">Old dashboard</main></body>'],
      htmlComplete: true,
      generating: false,
    });
    await flushSandboxImport(fixture);

    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="open-generative-ui-final-sandbox"]',
      ),
    ).not.toBeNull();

    setContent(fixture, {
      initialHeight: 360,
      generating: true,
    });
    fixture.detectChanges();

    expect(mockDestroy).toHaveBeenCalled();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="open-generative-ui-final-sandbox"]',
      ),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="open-generative-ui-placeholder"]',
      ),
    ).not.toBeNull();
  });
});

describe("CopilotOpenGenerativeUIActivityRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate = vi.fn(
      (_localApi: unknown, options: { frameContainer: HTMLElement }) =>
        createSandbox(options.frameContainer),
    );
    mockLoadWebsandbox = vi.fn().mockResolvedValue({ create: mockCreate });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CopilotOpenGenerativeUIActivityRenderer],
      providers: [
        {
          provide: COPILOT_KIT_CONFIG,
          useValue: { openGenerativeUI: {} },
        },
        {
          provide: OPEN_GENERATIVE_UI_WEBSANDBOX_LOADER,
          useValue: mockLoadWebsandbox,
        },
      ],
    });
  });

  it("adapts activity messages to the renderer component", () => {
    const fixture = TestBed.createComponent(
      CopilotOpenGenerativeUIActivityRenderer,
    );
    fixture.componentRef.setInput("activityType", "open-generative-ui");
    fixture.componentRef.setInput("content", { initialHeight: 180 });
    fixture.componentRef.setInput("message", {
      id: "activity-1",
      role: "activity",
      activityType: "open-generative-ui",
      content: { initialHeight: 180 },
    });
    fixture.componentRef.setInput("agent", undefined);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector(
        "copilot-open-generative-ui-renderer",
      ),
    ).not.toBeNull();

    fixture.destroy();
  });
});
