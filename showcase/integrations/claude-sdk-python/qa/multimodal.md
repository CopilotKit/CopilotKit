# QA: Multimodal Attachments — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- `ANTHROPIC_API_KEY` is set on the deployment
- `pypdf` is installed in the backend environment (listed in
  `requirements.txt`)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/multimodal`
- [ ] Verify the "Multimodal attachments" header renders
- [ ] Verify the bundled-samples row shows "Try with sample image" and
      "Try with sample PDF" buttons
- [ ] Verify the paperclip button is visible on the chat composer

### 2. Feature-Specific Checks

#### Sample image

- [ ] Click "Try with sample image" — the button should flip to
      "Loading…" briefly
- [ ] Verify the CopilotChat attachment strip shows a pending
      `sample.png` chip
- [ ] Type "What's in this image?" and send
- [ ] Verify Claude's reply references concrete visual details (e.g.
      colors, objects) from the bundled PNG

#### Sample PDF

- [ ] Click "Try with sample PDF"
- [ ] Verify the `sample.pdf` chip appears
- [ ] Type "Summarise this document" and send
- [ ] Verify Claude replies with a short summary of the PDF's actual
      content (not a generic "I cannot read PDFs" reply)

### 3. LFS-pointer guard

- [ ] If the deployment accidentally ships a Git LFS pointer instead of
      the real binary, clicking a sample button should surface
      `data-testid="multimodal-sample-error"` with an actionable message

### 4. Error Handling

- [ ] No console errors during normal usage.
- [ ] Upload a file over 10 MB and verify the attachment is rejected
      with a visible toast.

## Expected Results

- Image replies reference real visual details (not generic).
- PDF replies reference document-specific content.
- No silent dropping of attachments.
