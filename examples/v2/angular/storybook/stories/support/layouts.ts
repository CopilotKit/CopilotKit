import { componentWrapperDecorator } from "@storybook/angular";

// Layout wrappers shared by stories. Classes live in .storybook/preview.css.

/** A centered reading column, the width a chat transcript usually gets. */
export const withMessageColumn = componentWrapperDecorator(
  (story) => `<div class="story-column">${story}</div>`,
);

/** A centered stage for small standalone controls (inputs, pills, buttons). */
export const withCenteredStage = componentWrapperDecorator(
  (story) => `<div class="story-stage"><div>${story}</div></div>`,
);

/** Full-viewport frame for views that manage their own scrolling. */
export const withFullHeight = componentWrapperDecorator(
  (story) => `<div class="story-full-height">${story}</div>`,
);
