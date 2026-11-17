import { render } from "@testing-library/vue";
import { afterEach, describe, expect, it } from "vitest";
import { createSSRApp, defineComponent, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import {
  STANDARD_CSS,
  STANDARD_STYLE_ID,
} from "@copilotkit/shared/generative-ui";
import type { GenerativeUITheme } from "@copilotkit/shared/generative-ui";
import { useStandardStyles, useThemeStyleSheet } from "../standard-styles";

// React's useStandardStyles has no suite of its own. These cases pin the
// Vue composables of standard-styles.ts.

const Styled = defineComponent({
  setup() {
    useStandardStyles();
    return {};
  },
  template: `<span>styled</span>`,
});

const standardSheets = () =>
  document.head.querySelectorAll(`style#${STANDARD_STYLE_ID}`);

describe("useStandardStyles (Vue-specific semantics)", () => {
  afterEach(() => {
    for (const sheet of standardSheets()) sheet.remove();
  });

  it("adds the standard stylesheet to the document head once", () => {
    render(
      defineComponent({
        components: { Styled },
        template: `<Styled /><Styled />`,
      }),
    );
    render(Styled);
    expect(standardSheets()).toHaveLength(1);
    expect(standardSheets()[0]!.textContent).toBe(STANDARD_CSS);
  });

  it("adds nothing while it renders on the server", async () => {
    const html = await renderToString(createSSRApp(Styled));
    expect(html).toBe("<span>styled</span>");
    expect(standardSheets()).toHaveLength(0);
  });
});

describe("useThemeStyleSheet (Vue-specific semantics)", () => {
  it("gives the sheet of the theme, follows its changes, and gives undefined for no variables", async () => {
    const theme = ref<GenerativeUITheme | undefined>({
      "--a2ui-color-accent": "#111111",
    });
    let sheet: ReturnType<typeof useThemeStyleSheet> | undefined;
    render(
      defineComponent({
        setup() {
          sheet = useThemeStyleSheet(theme);
          return () => null;
        },
      }),
    );
    const first = sheet!.value!;
    expect(first.css).toBe(
      `.a2ui-surface[data-a2ui-theme="${first.id}"]{--a2ui-color-accent:#111111}`,
    );

    theme.value = { "--a2ui-color-accent": "#222222" };
    expect(sheet!.value!.css).toContain("--a2ui-color-accent:#222222");
    expect(sheet!.value!.id).not.toBe(first.id);

    theme.value = undefined;
    expect(sheet!.value).toBeUndefined();
  });
});
