<script lang="ts">
  import { Renderer, marked } from "marked";

  let {
    content = "",
  }: {
    content?: string;
  } = $props();

  const renderer = new Renderer();

  const originalCode = renderer.code.bind(renderer);
  renderer.code = ({ text, lang }) => {
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const langLabel = lang
      ? `<span class="cpk:text-xs cpk:text-muted-foreground cpk:px-2">${lang}</span>`
      : "";
    return `<div class="cpk:relative cpk:my-4 cpk:rounded-lg cpk:border cpk:border-border cpk:overflow-hidden" data-streamdown="code-block">
      <div class="cpk:flex cpk:items-center cpk:justify-between cpk:bg-muted/50 cpk:px-3 cpk:py-1.5 cpk:border-b cpk:border-border">${langLabel}</div>
      <pre class="cpk:overflow-x-auto cpk:p-3 cpk:text-sm"><code${lang ? ` class="language-${lang}"` : ""}>${escaped}</code></pre>
    </div>`;
  };

  renderer.image = ({ href, text }) => {
    const escapedHref = href?.replace(/"/g, "&quot;") ?? "";
    const escapedAlt = text ?? "";
    return `<div class="cpk:group cpk:relative cpk:my-4 cpk:inline-block" data-streamdown="image-wrapper">
      <img src="${escapedHref}" alt="${escapedAlt}" class="cpk:max-w-full cpk:rounded-lg" data-streamdown="image" />
      <div class="cpk:pointer-events-none cpk:absolute cpk:inset-0 cpk:hidden cpk:rounded-lg cpk:bg-black/10 cpk:group-hover:block"></div>
    </div>`;
  };

  renderer.table = (token) => {
    const headerCells = token.header
      .map((h: { text: string }) => `<th>${h.text}</th>`)
      .join("");
    const bodyRows = token.rows
      .map((row: { text: string }[]) =>
        `<tr>${row.map((c) => `<td>${c.text}</td>`).join("")}</tr>`,
      )
      .join("");
    return `<div class="cpk:my-4 cpk:flex cpk:flex-col cpk:space-y-2" data-streamdown="table-wrapper">
      <div class="cpk:overflow-x-auto">
        <table class="cpk:w-full cpk:border-collapse cpk:border cpk:border-border" data-streamdown="table">
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </div>`;
  };

  marked.setOptions({
    renderer,
    breaks: true,
    gfm: true,
  });

  let html = $derived(content ? marked.parse(content) : "");
</script>

{#if html}
  {@html html}
{/if}
