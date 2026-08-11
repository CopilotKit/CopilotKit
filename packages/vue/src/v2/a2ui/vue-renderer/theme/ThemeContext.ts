import {
  defineComponent,
  inject,
  provide,
  readonly,
  shallowRef,
  watch,
} from "vue";
import type { InjectionKey, PropType, Ref } from "vue";
import type { A2UITheme } from "../../types";

export const a2uiDefaultTheme: A2UITheme = {};

const ThemeKey: InjectionKey<Ref<A2UITheme>> = Symbol("A2UITheme");

export const ThemeProvider = defineComponent({
  name: "A2UIThemeProvider",
  props: {
    theme: {
      type: Object as PropType<A2UITheme>,
      required: false,
      default: undefined,
    },
  },
  setup(props, { slots }) {
    const themeRef = shallowRef<A2UITheme>(props.theme ?? a2uiDefaultTheme);

    watch(
      () => props.theme,
      (next) => {
        themeRef.value = next ?? a2uiDefaultTheme;
      },
    );

    provide(ThemeKey, themeRef);
    return () => slots.default?.();
  },
});

export function useTheme(): Readonly<Ref<A2UITheme>> {
  const theme = inject(ThemeKey, null);
  if (!theme) {
    throw new Error(
      "useTheme must be used within a ThemeProvider or A2UIProvider",
    );
  }
  return readonly(theme);
}

export function useThemeOptional(): Readonly<Ref<A2UITheme>> | undefined {
  const theme = inject(ThemeKey, null);
  return theme ? readonly(theme) : undefined;
}
