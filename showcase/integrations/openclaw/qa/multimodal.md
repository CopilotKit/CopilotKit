# QA: Multimodal Attachments (OpenClaw)

Demo source: `src/app/demos/multimodal/page.tsx`
Route: `/demos/multimodal` · Agent: `multimodal-demo` · Runtime: `/api/copilotkit-multimodal`
Run against the real backend at `http://localhost:3119/demos/multimodal`.

Status: **supported**, and verified end-to-end at the gateway level (a solid-red
image → "red"); see `PARITY_NOTES.md`.

## What it exercises

Image and PDF attachments flowing from the browser to a vision-capable model.
`CopilotChat` is configured with `attachments` (`AttachmentsConfig`): the
paperclip / "Add attachments" button accepts `image/*` and `application/pdf` up
to 10 MB, and `onUpload` inlines each file as base64 (`fileToDataAttachment` —
the demo does not upload to external storage). Two "Try with sample X" buttons
inject a bundled image or PDF and auto-send a canned prompt.

OpenClaw is a single stateless gateway with no per-demo backend, so multimodal
support is a **ag-ui gateway capability**, not per-demo logic: the runtime
route (`/api/copilotkit-multimodal`) proxies to the gateway, which extracts the
AG-UI image/document blocks and passes them to a vision-capable run (the model
input is configured with `image` support in `gateway/setup.sh`). A
`LegacyConverterShim` on the page rewrites the modern `image | document` content
parts to the legacy `binary` shape the converter understands before the request
leaves the runtime.

The sample buttons do **not** drive the paperclip DOM path. They build the
already-base64'd content part themselves and go through the V2 agent surface
directly (`agent.addMessage(...)` then `copilotkit.runAgent({ agent })`), which
avoids the "cannot send while attachments are uploading" race.

## Prerequisites

- Stack is up; demo reachable at the URL above.
- Gateway is healthy and configured with image-capable model input
  (`gateway/setup.sh`).
- Sample files are checked out (not Git LFS pointers) under
  `public/demo-files/sample.png` and `public/demo-files/sample.pdf`. The sample
  buttons fail loudly if LFS wasn't pulled.

## Manual steps

1. Open the demo. Confirm the sample row (`data-testid="multimodal-sample-row"`)
   renders with **Try with sample image** and **Try with sample PDF** buttons,
   and `CopilotChat` shows a composer with a paperclip / "Add attachments"
   button (it gives a one-shot attention bounce on load).
2. Click **Try with sample image**. Expect: the button flips to "Sending…", a
   user message with the image is posted, and the agent responds with a
   description referring to the image content (the verified fixture is a
   solid-red image → the model says "red").
3. Click **Try with sample PDF**. Expect: the PDF is posted and the agent
   responds with text about the document's contents.
4. Paperclip path: click the paperclip, pick a local image under 10 MB. An
   attachment chip appears in the composer. Type "What's in this image?" and
   send. Expect a description of the image.
5. (Optional) Attach a local PDF the same way and ask it to summarize the
   document.

## Assertion bar

- Sample buttons are disabled while any send is in flight (`disabled={loading}`),
  and re-enable afterwards.
- The agent's reply actually references the attachment content, not a generic
  acknowledgement.
- No console errors on the success paths. `onUploadFailed` logs a
  `[multimodal-demo]` warning on rejection — that warning during an intentional
  error case is expected, not a failure.

## Protocol-level check (no browser)

Inside the running container, POST a `RunAgentInput` whose last user message
carries an image/document block to the gateway operator route
(`http://127.0.0.1:8000/v1/ag-ui/operator`, Bearer gateway token,
`Accept: text/event-stream`) and confirm the SSE stream describes the image
content and ends with `RUN_FINISHED`.

## Caveats

- Multimodal responses are heavier than text-only; allow up to ~60s for the
  first token on a fresh run.
- Behaviour comes from the ag-ui multimodal capability plus the page's
  `LegacyConverterShim`, not a per-demo backend graph — image blocks are
  extracted at the gateway and passed to the vision model.
- Sample files served as Git LFS pointers (LFS not pulled at build) are caught
  by a magic-byte guard and surface an actionable error in the
  `data-testid="multimodal-sample-error"` span rather than sending broken bytes.
- The end-to-end verification exercised image input; PDF and arbitrary local
  uploads rely on the same proven pipeline but are not each individually
  fixture-covered yet (see `PARITY_NOTES.md`).
