"use client";

import * as React from "react";

/** Length of the open and close transitions for dialogs, drawers and menus. */
export const PRESENCE_MS = 200;

/**
 * Keeps an overlay mounted while it animates out, so it closes as smoothly as
 * it opens. `mounted` says whether to render it at all; `shown` drives the
 * transition classes (it turns on a frame after mounting so the opening
 * transition runs, and off as soon as `open` is false).
 */
export function usePresence(open: boolean, durationMs = PRESENCE_MS): { mounted: boolean; shown: boolean } {
  const [mounted, setMounted] = React.useState(open);
  const [shown, setShown] = React.useState(open);

  React.useEffect(() => {
    if (open) {
      setMounted(true);
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setShown(false);
    const timer = window.setTimeout(() => setMounted(false), durationMs);
    return () => window.clearTimeout(timer);
  }, [open, durationMs]);

  return { mounted, shown };
}

/**
 * Keeps the last non-null value, so a closing dialog does not go blank or
 * change its wording mid-transition. Pass primitives or stable references
 * (state values), not objects created during render.
 */
export function useLastDefined<T>(value: T | null | undefined): T | null {
  const [last, setLast] = React.useState<T | null>(value ?? null);
  if (value !== null && value !== undefined && value !== last) setLast(value);
  return value ?? last;
}

/** Transition classes shared by overlays. */
export const overlayBackdrop = (shown: boolean) =>
  `transition-opacity duration-200 ease-out motion-reduce:transition-none ${shown ? "opacity-100" : "opacity-0"}`;

export const overlayPanel = (shown: boolean) =>
  `transition-[opacity,scale,translate] duration-200 ease-out motion-reduce:transition-none ${
    shown ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-2"
  }`;

export const overlayMenu = (shown: boolean) =>
  `origin-top-right transition-[opacity,scale] duration-150 ease-out motion-reduce:transition-none ${
    shown ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-95"
  }`;
