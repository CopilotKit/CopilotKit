/**
 * Demo addition: the inline script the root layout runs before first paint on
 * /intelligence routes, doing what the Intelligence bootstrap's `applyWorkspaceThemePreference`
 * call does (same storage key as ./workspace-theme.ts). Kept free of React so
 * the server layout can import it.
 */
export const workspaceThemeBootstrap = `(function(){if(location.pathname.indexOf('/intelligence')!==0)return;var r=document.documentElement;var p='system';try{var s=localStorage.getItem('workspace-theme-preference');if(s==='light'||s==='dark')p=s;}catch(e){}r.setAttribute('data-cpki-theme',p);r.setAttribute('data-cpki-design','workspace');})();`;
