# @copilotkit/web-components

## 1.61.1

### Minor Changes

- Initial release. Adds the controlled, framework-agnostic
  `<copilotkit-drawer>` Lit custom element promoting the CopilotKit threads
  drawer into the SDK. Data flows in via properties; user intent flows out via
  DOM `CustomEvent`s (`thread-selected`, `archive`, `unarchive`, `delete`,
  `new-thread`, `filter-change`, `open-change`). Behavior parity with the
  framework forks: thread rows, Active/All filter, desktop collapse-to-rail,
  mobile off-canvas overlay with backdrop + focus trap + `Escape` + scroll-lock,
  confirm-delete flow, and empty/loading/error/upsell states. Customization via
  named slots (`header`, `footer`, `empty`, `memories`), `::part()` hooks, theme
  CSS custom properties, and a per-row render hook. Includes a reserved,
  hidden-until-populated `memories` region.
