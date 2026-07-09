import localFont from "next/font/local";

export const plusJakartaSans = localFont({
  src: "./fonts/PlusJakartaSans-VariableFont_wght.woff2",
  display: "swap",
  variable: "--font-prose",
  weight: "200 800",
});

export const splineSansMono = localFont({
  src: "./fonts/SplineSansMono-VariableFont_wght.woff2",
  display: "swap",
  variable: "--font-code",
  weight: "300 700",
});
