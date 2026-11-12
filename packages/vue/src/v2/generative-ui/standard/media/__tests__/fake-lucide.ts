// A stand-in for `lucide`, which Icon imports lazily. The real module has
// about 1,500 icons, each stored as `[tag, attributes]` pairs. The icons
// component renders each as an `svg.lucide.lucide-<name>` with its paths.

export const icons = {
  ArrowRight: [
    ["path", { d: "M5 12h14" }],
    ["path", { d: "m12 5 7 7-7 7" }],
  ],
  Check: [["path", { d: "M20 6 9 17l-5-5" }]],
};
