/**
 * The desktop sidebar's collapsed state, kept in a cookie so the server renders
 * the shell in the same state after a refresh (no flash of the open sidebar).
 * Not a "use client" module: the server layout reads the cookie name from here.
 */
export const SIDEBAR_COOKIE = "ordiq-sidebar";

export function sidebarOpenFromCookie(value: string | undefined): boolean {
  return value !== "collapsed";
}

export function saveSidebarOpen(open: boolean): void {
  document.cookie = `${SIDEBAR_COOKIE}=${open ? "open" : "collapsed"}; path=/; max-age=31536000; samesite=lax`;
}
