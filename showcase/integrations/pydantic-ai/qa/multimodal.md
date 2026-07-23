# QA: Multimodal Attachments — PydanticAI

## Prerequisites

- Demo deployed and accessible at `/demos/multimodal`
- Agent backend healthy (check `/api/health`)
- `OPENAI_API_KEY` set
- Bundled `public/demo-files/sample.png` and `public/demo-files/sample.pdf`
  present (copied over from the langgraph-python reference assets)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/multimodal`
- [ ] Verify the header "Multimodal attachments" is visible
- [ ] Verify the sample-row is visible with two buttons:
      "Try with sample image" and "Try with sample PDF"
- [ ] Verify `<CopilotChat />` renders a message composer

### 2. Sample image round-trip

- [ ] Click "Try with sample image"
- [ ] Within 10 seconds, an attachment chip labelled `sample.png`
      appears in the composer
- [ ] Type "Describe this image" and click send
- [ ] Within 90 seconds, an assistant response renders that references
      the CopilotKit / logo / image content

### 3. Sample PDF round-trip

- [ ] Click "Try with sample PDF"
- [ ] Within 10 seconds, an attachment chip labelled `sample.pdf`
      appears in the composer
- [ ] Type "Summarize this document" and click send
- [ ] Within 90 seconds, an assistant response renders that references
      the document contents (should mention "CopilotKit")

## Known Limitations vs. langgraph-python port

- PydanticAI's AG-UI bridge does not expose a LangChain-style
  `before_model` middleware. The equivalent behaviour is implemented via
  a PydanticAI `history_processors` hook that rewrites incoming binary
  parts into `image_url` (for GPT-4o vision) or extracted text (for
  PDFs via `pypdf`) before each model call. Functionally equivalent to
  the langgraph-python reference.
- The frontend's `onRunInitialized` shim (rewriting modern
  image/document parts into legacy `binary` parts) is framework-agnostic
  and kept intact so the Python-side history processor sees the same
  wire shape the langgraph-python reference does.

## Expected Results

- Images flow through to GPT-4o vision natively.
- PDFs flatten to inline text; the agent can answer questions about the
  document contents.
- Bundled samples work without mic / file-picker permission dialogs.
