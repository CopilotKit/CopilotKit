# Built-in Agent local runtime comparison

Latest bounded full runs: **31/39 before → 38/39 after**. All 38 published checks pass; the unshipped thread-ID demo remains a strict-fixture failure.

| Check                    | Before | After |
| ------------------------ | ------ | ----- |
| frontend-tools-async     | Fail   | Pass  |
| gen-ui-headless-complete | Fail   | Pass  |
| gen-ui-open              | Fail   | Pass  |
| gen-ui-open-advanced     | Fail   | Pass  |
| multimodal               | Fail   | Pass  |
| readonly-state-context   | Fail   | Pass  |
| voice                    | Fail   | Pass  |

The runs use local AIMock and the unreleased core URL repair. Fixes include both application behavior and test/replay accuracy; this is not a claim that seven independent backend defects were fixed. Voice validates the prepared transcript handoff, not microphone capture or transcription. Exact per-check outcomes and original log paths are in [the machine-readable comparison](built-in-agent-runtime-comparison-20260913.json).

Normal-browser observations: [image and PDF](built-in-agent-multimodal-browser-20260913.md), [voice sample](built-in-agent-voice-browser-20260913.md).
