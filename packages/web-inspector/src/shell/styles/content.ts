import { css } from "lit";

export const shellContentStyles = css`
  /* ── Agent/context dropdown ──────────────────────────────────── */
  [data-context-dropdown-root="true"] > button {
    border-color: #dbdbe5 !important;
    color: #010507 !important;
  }
  [data-context-dropdown-root="true"] > button:hover {
    border-color: #bec2ff !important;
    background-color: #f7f7f9 !important;
  }
  [data-context-dropdown-root="true"] > button > span:last-child {
    color: #68686e !important;
  }
  [data-context-dropdown-root="true"] > div {
    border-color: #dbdbe5 !important;
    box-shadow: 0 4px 12px rgba(1, 5, 7, 0.08) !important;
  }
  [data-context-dropdown-root="true"] > div button:hover,
  [data-context-dropdown-root="true"] > div button:focus {
    background-color: #eceafa !important;
    color: #2f1664 !important;
  }
  .inspector-sidebar
    .inspector-agent-selector
    > [data-context-dropdown-root="true"]
    > button {
    border-color: #d8d8e8 !important;
    background-color: rgba(255, 255, 255, 0.7) !important;
    color: #010507 !important;
  }
  .inspector-sidebar
    .inspector-agent-selector
    > [data-context-dropdown-root="true"]
    > button:hover {
    border-color: #a5a9ee !important;
    background-color: #ffffff !important;
  }
  .inspector-sidebar
    .inspector-agent-selector
    > [data-context-dropdown-root="true"]
    > button
    > span:last-child {
    color: #68686e !important;
  }

  /* ── Resize handle ───────────────────────────────────────────── */
  .resize-handle {
    color: #68686e !important;
  }
  .resize-handle:hover {
    color: #57575b !important;
  }

  /* ── AG-UI Events tab ────────────────────────────────────────── */
  /* Row hover: replace blue tint with brand lilac */
  tr:hover td {
    background-color: rgba(190, 194, 255, 0.08) !important;
  }
  /* Reset/dark action button */
  button[class*="bg-gray-900"] {
    background-color: #010507 !important;
  }
  button[class*="bg-gray-800"] {
    background-color: #2b2b2b !important;
  }
  /* Copy "copied" state: generic green → brand mint */
  button[class*="bg-green-100"] {
    background-color: rgba(133, 236, 206, 0.2) !important;
    color: #087653 !important;
  }

  /* ── Agents tab ──────────────────────────────────────────────── */
  /* Agent icon bubble: blue → lilac */
  span[class*="bg-blue-100"]:not([class*="text-blue-800"]) {
    background-color: rgba(190, 194, 255, 0.15) !important;
  }
  span[class*="text-blue-600"] {
    color: #5558b2 !important;
  }
  /* Running badge: emerald → mint */
  span[class*="bg-emerald-50"] {
    background-color: rgba(133, 236, 206, 0.15) !important;
  }
  span[class*="text-emerald-700"] {
    color: #087653 !important;
  }
  /* Running status dot */
  span[class*="bg-emerald-500"] {
    background-color: #85ecce !important;
  }
  /* Idle dot */
  span[class*="bg-gray-400"] {
    background-color: #afafb7 !important;
  }
  /* User role badge (blue → lilac) */
  span[class*="bg-blue-100"][class*="text-blue-800"] {
    background-color: rgba(190, 194, 255, 0.22) !important;
    border: 1px solid rgba(190, 194, 255, 0.45) !important;
    color: #57575b !important;
  }
  /* Assistant role badge (green → mint) */
  span[class*="bg-green-100"][class*="text-green-800"] {
    background-color: rgba(133, 236, 206, 0.18) !important;
    border: 1px solid rgba(133, 236, 206, 0.4) !important;
    color: #087653 !important;
  }
  /* Tool role badge (amber → orange brand) */
  span[class*="bg-amber-100"][class*="text-amber-800"] {
    background-color: rgba(255, 172, 77, 0.15) !important;
    color: #57575b !important;
  }

  /* ── Frontend Tools tab ──────────────────────────────────────── */
  /* Handler badge (blue → lilac) */
  span[class*="bg-blue-50"][class*="text-blue-700"] {
    background-color: rgba(190, 194, 255, 0.12) !important;
    border-color: rgba(190, 194, 255, 0.3) !important;
    color: #010507 !important;
  }
  /* Renderer badge (purple → lilac-adjacent) */
  span[class*="bg-purple-50"][class*="text-purple-700"] {
    background-color: rgba(190, 194, 255, 0.12) !important;
    border-color: rgba(190, 194, 255, 0.3) !important;
    color: #57575b !important;
  }
  /* Required badge (rose → brand red) */
  span[class*="bg-rose-50"][class*="text-rose-700"] {
    background-color: rgba(250, 95, 103, 0.1) !important;
    border-color: rgba(250, 95, 103, 0.25) !important;
    color: #fa5f67 !important;
  }
  /* Code/default value blocks */
  code[class*="bg-gray-100"],
  span[class*="bg-gray-100"] {
    background-color: #f0f0f4 !important;
  }

  /* ── Connected status bar: match threads header mint (#5BE4BB) ──── */
  /* Outer strip bg + top border + text when connected badge is present */
  .inspector-window
    > div
    > div:last-child
    > div:last-child:has(div[class*="bg-emerald-50"]) {
    background-color: rgba(91, 228, 187, 0.08) !important;
    border-top-color: rgba(91, 228, 187, 0.3) !important;
    color: #087653 !important;
  }
  /* Inner badge — slightly more opaque on the mint bg */
  div[class*="bg-emerald-50"][class*="border-emerald-200"] {
    background-color: rgba(91, 228, 187, 0.12) !important;
    border-color: rgba(91, 228, 187, 0.4) !important;
    color: #087653 !important;
  }
  div[class*="bg-emerald-50"][class*="border-emerald-200"]
    span[class*="opacity-80"] {
    opacity: 1 !important;
  }
  /* Icon bubble inside connected badge → mint tint */
  div[class*="bg-emerald-50"] span[class*="bg-white"] {
    background-color: rgba(91, 228, 187, 0.3) !important;
  }

  /* ── Announcement panel ──────────────────────────────────────── */
  div[class*="border-slate-200"][class*="bg-white"] {
    border-color: #dbdbe5 !important;
  }
  /* Announcement icon bubble: black → brand light lavender + lilac icon */
  span[class*="bg-slate-900"],
  div[class*="bg-slate-900"] {
    background-color: #eee6fe !important;
    color: #5558b2 !important;
  }
  span[class*="text-slate-800"],
  div[class*="text-slate-800"] {
    color: #010507 !important;
  }
`;
