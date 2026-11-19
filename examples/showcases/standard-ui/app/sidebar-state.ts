/** Where the sidebar's collapsed state is kept, and the <html> attribute that applies it. */
export const SIDEBAR_KEY = "ck-sidebar";

/**
 * Runs in <head> before paint, so a collapsed sidebar never flashes open.
 * Storage can throw (private windows, blocked site data): then it stays open.
 */
export const SIDEBAR_BOOT = `try{if(localStorage.getItem("${SIDEBAR_KEY}")==="collapsed")document.documentElement.dataset.sidebar="collapsed"}catch(e){}`;
