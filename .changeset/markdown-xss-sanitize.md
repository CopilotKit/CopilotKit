---
"@copilotkit/react-ui": patch
---

fix(react-ui): sanitize Markdown output to prevent XSS (fixes #3938)

The `Markdown` component used `rehype-raw` without a sanitizer, so raw HTML in LLM responses (including `<script>`, `<iframe>`, inline event handlers, and `javascript:` URLs) rendered as live DOM. Adds `rehype-sanitize` to the plugin pipeline so dangerous elements are stripped while safe HTML (`<br>`, `<details>`, `<kbd>`) and Markdown features (GFM tables, code blocks, links) still render.
