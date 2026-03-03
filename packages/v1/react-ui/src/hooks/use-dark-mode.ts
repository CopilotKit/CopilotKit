export const useDarkMode = () => {
  if (typeof window === "undefined") return false;
  return (
    document.documentElement.classList.contains("dark") ||
    document.body.classList.contains("dark") ||
    document.documentElement.getAttribute("data-theme") === "dark" ||
    document.body.getAttribute("data-theme") === "dark" ||
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
};
