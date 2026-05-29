# QA: Multimodal Attachments — LangGraph (Python)

## Prerequisites

- Demo deployed and accessible at `/demos/multimodal`
- Railway service `showcase-langgraph-python` is healthy
- `OPENAI_API_KEY` set on the Railway service (vision calls require it)
- Agent is using a vision-capable model (`gpt-4o` or equivalent) — verifiable by
  inspecting the Railway logs for `src/agents/multimodal_agent.py` or by
  running one image round-trip
- Sample files are bundled under `public/demo-files/`:
  - `sample.png` — a small PNG the vision model can describe
  - `sample.pdf` — a small one-page PDF mentioning "CopilotKit"

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/multimodal`
- [ ] Verify the page header "Multimodal attachments" is visible
- [ ] Verify the description text mentions image and PDF attachments
- [ ] Verify the sample-row (`[data-testid="multimodal-sample-row"]`) is visible
- [ ] Verify the "Try with sample image" and "Try with sample PDF" buttons are
      present and enabled
- [ ] Verify `<CopilotChat />` renders a message composer with a paperclip /
      "Add attachments" button

### 2. Sample image path

- [ ] Click "Try with sample image"
- [ ] Button label briefly flips to "Loading…"
- [ ] Within 5 seconds an image attachment chip appears in the composer with a
      thumbnail preview
- [ ] Type "Describe this image"
- [ ] Click send
- [ ] Within 60 seconds the agent responds with a description referring to the
      image content (e.g. mentions a logo, colors, or brand mark)

### 3. Sample PDF path

- [ ] Click "Try with sample PDF"
- [ ] A document attachment chip appears in the composer (filename
      "sample.pdf" visible, document icon)
- [ ] Type "Summarize this document"
- [ ] Click send
- [ ] Within 60 seconds the agent responds with text that mentions "CopilotKit"
      (the sample PDF contains the word multiple times)

### 4. Paperclip / real upload path (manual)

- [ ] Click the paperclip / "Add attachments" button
- [ ] File picker opens filtered to `image/*` and `application/pdf`
- [ ] Select a local image under 10 MB
- [ ] Attachment chip renders in the composer within 2 seconds
- [ ] Type "What's in this image?" and send
- [ ] Agent responds with a description of the image content

### 5. Drag-and-drop

- [ ] Drag a local image onto the chat container
- [ ] Chat surface shows a drop affordance
- [ ] On drop, an attachment chip appears
- [ ] Sending a prompt works the same as the paperclip path

### 6. Multi-attachment

- [ ] Inject the sample image AND the sample PDF (click both buttons sequentially)
- [ ] Both chips are visible in the composer
- [ ] Type "What do these two attachments have in common?"
- [ ] Click send
- [ ] Agent response acknowledges both attachments

### 7. Error Handling

- [ ] Try to attach a file over 10 MB via the paperclip
- [ ] Verify `onUploadFailed` fires (console warning from the page) and the
      file is rejected without corrupting the composer
- [ ] Try to attach an unsupported type (e.g. `.exe`) — the file picker filter
      excludes it or `onUploadFailed` fires with `reason: "invalid-type"`
- [ ] Block `/demo-files/sample.png` in DevTools Network; click "Try with
      sample image"; the `multimodal-sample-error` span shows a helpful error
      without crashing the page

## Expected Results

- Attachment chip appears within 2 seconds after upload or sample injection
- Thumbnail renders for image attachments; document icon for PDFs
- Agent response arrives within 60 seconds for single-attachment prompts
  (multimodal tokens are heavier than text-only)
- No console errors during successful flows (warnings from `onUploadFailed`
  during intentional error cases are acceptable)
- Error states are visible and recoverable — the user can retry
