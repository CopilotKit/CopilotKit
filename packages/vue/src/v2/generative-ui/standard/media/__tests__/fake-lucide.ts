import { h } from "vue";
import type { FunctionalComponent } from "vue";

// A stand-in for lucide-vue-next, which Icon imports lazily. The real module
// has about 1,500 icons. Each fake icon renders what a lucide-vue-next icon
// renders: an `svg.lucide.lucide-<name>` with its paths, `color` as the
// stroke, `strokeWidth` as the stroke width, and the other attributes as
// they are.

function fakeIcon(name: string, paths: string[]) {
  const icon: FunctionalComponent = (_props, { attrs }) => {
    const { color, strokeWidth, ...rest } = attrs;
    return h(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: color ?? "currentColor",
        "stroke-width": strokeWidth ?? 2,
        class: `lucide lucide-${name}`,
        ...rest,
      },
      paths.map((d) => h("path", { d })),
    );
  };
  icon.inheritAttrs = false;
  return icon;
}

export const icons = {
  ArrowRight: fakeIcon("arrow-right", ["M5 12h14", "m12 5 7 7-7 7"]),
  Check: fakeIcon("check", ["M20 6 9 17l-5-5"]),
};
