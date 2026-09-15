---
name: CopilotKit partner landing pages
description: A quiet introduction from a partner agent framework to a working app integration.
---

# Partner landing design

## Overview

These pages serve developers who already have a partner framework in mind and need to understand what CopilotKit adds, how to connect it, and where to learn more.
Keep the small CopilotKit + partner masthead: it establishes partnership context above the product headline. The page should feel like part of the docs, with clear copy and restrained decoration.

## Colors

Inherit the docs theme tokens from `src/app/globals.css`: `--text` for headings, `--text-secondary` for descriptions, and `--text-muted` for supporting labels.
Use `--accent` for links, small icons, selected video controls, and focus. Surfaces use `--bg-surface`, hover uses `--bg-elevated`, and outlines use `--border`; selected video controls also use `--accent-dim`.
Keep light and dark modes on these shared tokens rather than introducing a partner-specific palette.

## Typography

Inherit the docs font. Use a balanced headline with a 22-character measure, fluid size (`clamp(2rem, 3.4vw, 2.9rem)`), weight 600, and tight line height (1.12).
Section headings are 1.4rem; card headings are 0.95rem. Card descriptions are 0.8125rem with a 1.55 line height. Keep body copy readable and concise.
The hero summary explains the product relationship; capability descriptions explain concrete behavior. Setup copy names the connection being made, and compatibility copy must match the selected framework rather than imply unsupported parity.

## Layout

Order the shared page: partner identity and introduction, start actions, product walkthrough, capabilities, tutorial and connection code, Intelligence, optional custom content, then optional architecture details.
Keep videos high on the page. Put secondary detail behind native disclosures so the introduction remains easy to scan.
Capability cards use three equal columns and equal grid rows; Intelligence uses two equal columns. Both grids collapse to one column at 639px and below.
Use a 0.75rem grid gap and 2.75rem section spacing; narrow screens reduce these to 0.6rem and 2.25rem. Keep code horizontally scrollable within its container.

## Elevation & Depth

Separate sections with space and occasional thin rules. Cards have a quiet surface and border; hover changes the border and background without lifting or scaling them.
“And More” content is a subdued text link, currently “Explore all capabilities.” Intelligence remains a secondary section with compact cards and a plain exploration link.

## Shapes

Cards, the video frame, and architecture imagery use 12px corners. Video controls and focus outlines use 6px corners.
Keep icons small, consistent, and subordinate to the labels. Avoid decorative backgrounds that compete with the product footage.

## Components

Each capability or Intelligence card is one fully clickable link, including its title and description. Do not nest buttons or extra links inside it.
Keep both hero entry points: a coding-agent prompt and the quickstart. Retain the visible tutorial row and its framework-specific destination; connection code belongs in an expandable details element.
Videos use native controls, inline playback, metadata preload, and no autoplay. The player keeps a 16:9 frame; selection buttons expose `aria-pressed` and reset the player when the source changes.
Show loading and failure feedback with an “Open video” fallback. Label the footage as a React product walkthrough so other frontend selections do not imply the recording demonstrates their frontend.
All links, buttons, and disclosure summaries receive a visible 2px accent outline with a 4px offset. Disable transitions for reduced-motion preferences; ordinary hover transitions take 150ms.
Resolve internal guide links through `frameworkLandingHref` so the chosen backend and frontend prefix survive navigation. Preserve external destinations and select connection code and showcase integration by the current framework slug.
Preserve `iconOverride`, `connectSnippet`, and `afterFeatures`; custom content takes precedence over the configured CTA. Retain configured architecture images and videos in the final disclosure.

## Do's and Don'ts

- Do use the shared overview and theme rules for consistent authored and generated partner pages.
- Do preserve tutorials, working destinations, variant-specific setup, and custom content when simplifying the presentation.
- Do keep capability cards equal and media prominent, with Intelligence and extra capabilities quieter.
- Do not turn feature descriptions into marketing claims or treat a shared React recording as proof of every integration's compatibility.
