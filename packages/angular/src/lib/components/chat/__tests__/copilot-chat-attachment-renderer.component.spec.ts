import {
  EnvironmentInjector,
  runInInjectionContext,
  signal,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CopilotChatAttachmentDocument,
  CopilotChatAttachmentImage,
  CopilotChatAttachmentRenderer,
} from "../copilot-chat-attachment-renderer";
import type {
  AttachmentModality,
  InputContentSource,
} from "../copilot-chat-attachment-renderer.types";

const dataSource: InputContentSource = {
  type: "data",
  value: "BASE64DATA",
  mimeType: "image/png",
};

const urlSource: InputContentSource = {
  type: "url",
  value: "https://example.com/file.mp4",
  mimeType: "video/mp4",
};

const pdfSource: InputContentSource = {
  type: "data",
  value: "PDFDATA",
  mimeType: "application/pdf",
};

interface RendererBindings {
  type: ReturnType<typeof signal<AttachmentModality>>;
  source: ReturnType<typeof signal<InputContentSource>>;
  filename: ReturnType<typeof signal<string | undefined>>;
  inputClass: ReturnType<typeof signal<string | undefined>>;
}

function buildRenderer(initial: {
  type: AttachmentModality;
  source: InputContentSource;
  filename?: string;
  inputClass?: string;
}): { component: CopilotChatAttachmentRenderer; bindings: RendererBindings } {
  const injector = TestBed.inject(EnvironmentInjector);
  const component = runInInjectionContext(
    injector,
    () => new CopilotChatAttachmentRenderer(),
  );
  const bindings: RendererBindings = {
    type: signal<AttachmentModality>(initial.type),
    source: signal<InputContentSource>(initial.source),
    filename: signal(initial.filename),
    inputClass: signal(initial.inputClass),
  };
  (component as unknown as { type: () => AttachmentModality }).type = () =>
    bindings.type();
  (component as unknown as { source: () => InputContentSource }).source = () =>
    bindings.source();
  (component as unknown as { filename: () => string | undefined }).filename =
    () => bindings.filename();
  (
    component as unknown as { inputClass: () => string | undefined }
  ).inputClass = () => bindings.inputClass();
  return { component, bindings };
}

describe("CopilotChatAttachmentRenderer", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  it("derives src as a base64 data URL for data sources", () => {
    const { component } = buildRenderer({ type: "image", source: dataSource });
    expect(component.src()).toBe("data:image/png;base64,BASE64DATA");
  });

  it("derives src as the original URL for url sources", () => {
    const { component } = buildRenderer({ type: "video", source: urlSource });
    expect(component.src()).toBe("https://example.com/file.mp4");
  });

  it("recomputes src when the source input changes", () => {
    const { component, bindings } = buildRenderer({
      type: "image",
      source: dataSource,
    });
    expect(component.src()).toContain("BASE64DATA");
    bindings.source.set(urlSource);
    expect(component.src()).toBe("https://example.com/file.mp4");
  });

  it("exposes a slot context with type, source, src, filename, inputClass", () => {
    const { component } = buildRenderer({
      type: "document",
      source: pdfSource,
      filename: "report.pdf",
      inputClass: "extra",
    });
    const ctx = component.slotContext();
    expect(ctx.type).toBe("document");
    expect(ctx.source).toBe(pdfSource);
    expect(ctx.src).toBe("data:application/pdf;base64,PDFDATA");
    expect(ctx.filename).toBe("report.pdf");
    expect(ctx.inputClass).toBe("extra");
  });

  it("recomputes the slot context when type changes", () => {
    const { component, bindings } = buildRenderer({
      type: "image",
      source: dataSource,
    });
    expect(component.slotContext().type).toBe("image");
    bindings.type.set("audio");
    expect(component.slotContext().type).toBe("audio");
  });
});

interface ImageBindings {
  src: ReturnType<typeof signal<string>>;
  filename: ReturnType<typeof signal<string | undefined>>;
  inputClass: ReturnType<typeof signal<string | undefined>>;
}

function buildImage(initial: {
  src?: string;
  filename?: string;
  inputClass?: string;
}): { component: CopilotChatAttachmentImage; bindings: ImageBindings } {
  const injector = TestBed.inject(EnvironmentInjector);
  const component = runInInjectionContext(
    injector,
    () => new CopilotChatAttachmentImage(),
  );
  const bindings: ImageBindings = {
    src: signal(initial.src ?? ""),
    filename: signal(initial.filename),
    inputClass: signal(initial.inputClass),
  };
  (component as unknown as { src: () => string }).src = () => bindings.src();
  (component as unknown as { filename: () => string | undefined }).filename =
    () => bindings.filename();
  (
    component as unknown as { inputClass: () => string | undefined }
  ).inputClass = () => bindings.inputClass();
  return { component, bindings };
}

describe("CopilotChatAttachmentImage", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  it("merges inputClass into the container class", () => {
    const { component } = buildImage({ inputClass: "ring-2" });
    expect(component.containerClass()).toContain("ring-2");
    expect(component.containerClass()).toContain("rounded-md");
  });

  it("transitions to error state when handleError is called", () => {
    const { component } = buildImage({ src: "http://x/y.png" });
    expect((component as unknown as { errored: () => boolean }).errored()).toBe(
      false,
    );
    component.handleError();
    expect((component as unknown as { errored: () => boolean }).errored()).toBe(
      true,
    );
  });

  it("merges inputClass into the error state class", () => {
    const { component } = buildImage({ inputClass: "ring-red" });
    component.handleError();
    expect(component.errorClass()).toContain("ring-red");
  });
});

interface DocumentBindings {
  source: ReturnType<typeof signal<InputContentSource>>;
  filename: ReturnType<typeof signal<string | undefined>>;
  inputClass: ReturnType<typeof signal<string | undefined>>;
}

function buildDocument(initial: {
  source: InputContentSource;
  filename?: string;
  inputClass?: string;
}): { component: CopilotChatAttachmentDocument; bindings: DocumentBindings } {
  const injector = TestBed.inject(EnvironmentInjector);
  const component = runInInjectionContext(
    injector,
    () => new CopilotChatAttachmentDocument(),
  );
  const bindings: DocumentBindings = {
    source: signal(initial.source),
    filename: signal(initial.filename),
    inputClass: signal(initial.inputClass),
  };
  (component as unknown as { source: () => InputContentSource }).source = () =>
    bindings.source();
  (component as unknown as { filename: () => string | undefined }).filename =
    () => bindings.filename();
  (
    component as unknown as { inputClass: () => string | undefined }
  ).inputClass = () => bindings.inputClass();
  return { component, bindings };
}

describe("CopilotChatAttachmentDocument", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  it("renders a PDF icon for application/pdf sources", () => {
    const { component } = buildDocument({ source: pdfSource });
    expect(component.icon()).toBe("PDF");
  });

  it("renders a generic FILE icon for an unknown mime type", () => {
    const { component } = buildDocument({
      source: { type: "data", value: "x", mimeType: "application/x-binary" },
    });
    expect(component.icon()).toBe("FILE");
  });

  it("uses filename as the display name when provided", () => {
    const { component } = buildDocument({
      source: pdfSource,
      filename: "annual-report.pdf",
    });
    expect(component.displayName()).toBe("annual-report.pdf");
  });

  it("falls back to mimeType when no filename is provided", () => {
    const { component } = buildDocument({ source: pdfSource });
    expect(component.displayName()).toBe("application/pdf");
  });

  it("falls back to 'Unknown type' when neither filename nor mimeType is available", () => {
    const { component } = buildDocument({
      source: { type: "data", value: "x", mimeType: "" },
    });
    expect(component.displayName()).toBe("Unknown type");
  });
});
