"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";

export function useTheme() {
    const [theme, setTheme] = useState<Theme>("system");

    useEffect(() => {
        const storedTheme = localStorage.getItem("theme") as Theme | null;
        if (storedTheme) {
            setTheme(storedTheme);
            applyTheme(storedTheme);
        } else {
            // Default to system preference
            applyTheme("system");
        }
    }, []);

    function applyTheme(newTheme: Theme) {
        const root = window.document.documentElement;
        root.classList.remove("dark", "light");

        if (newTheme === "system") {
            const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
                ? "dark"
                : "light";
            root.classList.add(systemTheme);
        } else {
            root.classList.add(newTheme);
        }
    }

    const setThemeValue = (newTheme: Theme) => {
        setTheme(newTheme);
        localStorage.setItem("theme", newTheme);
        applyTheme(newTheme);
    };

    return { theme, setTheme: setThemeValue };
} 