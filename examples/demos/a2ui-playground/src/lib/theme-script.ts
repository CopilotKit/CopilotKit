/**
 * The pre-paint script, apart from the client hook in ./theme.ts so the root layout (a server component)
 * gets the string itself rather than a client reference.
 */
export const THEME_KEY = "a2ui-theme";

/**
 * Runs in <head> before the first paint, so a dark visitor never sees the light page flash. It also marks a
 * side panel the visitor collapsed (workbench.tsx), so the playground does not open it for a frame.
 */
export const THEME_SCRIPT = `(function(){try{var q=new URLSearchParams(location.search).get("theme");var t=q==="dark"||q==="light"?q:localStorage.getItem("${THEME_KEY}");var d=t==="dark";var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";if(localStorage.getItem("a2ui-writes-pane")==="collapsed")e.dataset.wbPane="collapsed"}catch(_){}})()`;
