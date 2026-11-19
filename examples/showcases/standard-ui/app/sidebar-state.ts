/** Where the sidebar's collapsed state is kept, and the <html> attribute that applies it. */
export const SIDEBAR_KEY = "ck-sidebar";

/**
 * Runs in <head> before paint, so a collapsed sidebar never flashes open.
 * With nothing stored it starts collapsed on mid-size screens (900-1199px),
 * where it would take a third of the width, and open on wide ones. Storage
 * can throw (private windows, blocked site data): then it stays open.
 */
export const SIDEBAR_BOOT = `try{var s=localStorage.getItem("${SIDEBAR_KEY}");if(s==="collapsed"||(s===null&&innerWidth>=900&&innerWidth<1200))document.documentElement.dataset.sidebar="collapsed"}catch(e){}`;
