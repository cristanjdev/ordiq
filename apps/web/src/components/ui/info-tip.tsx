"use client";

import { CircleAlert, X } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { infoTipPosition } from "@/lib/info-tip-position";
import { cn } from "@/lib/utils";

/**
 * Exclamation button that opens the setting's explanation: a floating bubble
 * under the title on larger screens, a card at the bottom on phones.
 * Closes on a second click, an outside click or Escape.
 */
export function InfoTip({
  title,
  children,
  align = "center",
}: {
  title: string;
  children: React.ReactNode;
  align?: "center" | "end";
}) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLSpanElement>(null);
  const popupRef = React.useRef<HTMLSpanElement>(null);
  const contentRef = React.useRef<HTMLSpanElement>(null);
  const [position, setPosition] = React.useState<ReturnType<typeof infoTipPosition> | null>(null);
  const id = React.useId();

  const close = () => {
    setOpen(false);
    wrapRef.current?.querySelector("button")?.focus();
  };

  React.useLayoutEffect(() => {
    if (!open) return;
    const boundary = wrapRef.current?.closest("main");
    const update = () => {
      const anchor = wrapRef.current?.getBoundingClientRect();
      if (!anchor || !contentRef.current) return;
      setPosition(
        infoTipPosition({
          anchor,
          boundary: boundary?.getBoundingClientRect(),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          height: contentRef.current.scrollHeight + 2,
          align,
        }),
      );
    };
    update();
    const observer = new ResizeObserver(update);
    if (wrapRef.current) observer.observe(wrapRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    if (boundary) observer.observe(boundary);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, align]);

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (
        !wrapRef.current?.contains(e.target as Node) &&
        !popupRef.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        wrapRef.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className="relative inline-flex shrink-0 align-middle">
      <button
        type="button"
        aria-label={`About ${title}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setPosition(null);
          setOpen((o) => !o);
        }}
        className={cn(
          "inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ordiq-orange)]",
          open
            ? "bg-[var(--ordiq-maroon)]/10 text-[var(--ordiq-maroon)] dark:bg-[var(--ordiq-orange)]/20 dark:text-[var(--ordiq-orange)]"
            : "text-[var(--ordiq-muted)] hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-maroon)] dark:hover:text-[var(--ordiq-orange)]",
        )}
      >
        <CircleAlert className="h-4 w-4" />
      </button>
      {open &&
        createPortal(
          <>
            {/* Phones: dim the page behind the bottom card */}
            <span className="fixed inset-0 z-[69] bg-black/30 sm:hidden" aria-hidden="true" />
            <span
              id={id}
              ref={popupRef}
              role="dialog"
              aria-label={title}
              className="fixed z-[70] block rounded-xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] text-left shadow-xl animate-info-pop"
              style={{
                left: position?.left ?? 12,
                top: position?.top ?? 12,
                width: position?.width ?? 320,
                visibility: position ? "visible" : "hidden",
              }}
            >
              {/* Bubble tail (larger screens) */}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute hidden h-3 w-3 rotate-45 border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] sm:block",
                  position?.above ? "-bottom-1.5 border-b border-r" : "-top-1.5 border-l border-t",
                )}
                style={{ left: position?.arrowLeft ?? 12 }}
              />
              <span
                ref={contentRef}
                className="relative block overflow-y-auto rounded-xl p-4"
                style={{ maxHeight: position ? Math.max(0, position.maxHeight - 2) : undefined }}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="text-sm font-semibold text-[var(--ordiq-ink)]">{title}</span>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={close}
                    className="-mr-1 -mt-1 inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-[var(--ordiq-muted)] hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-ink)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
                <span className="mt-1.5 block text-xs font-normal leading-relaxed text-[var(--ordiq-muted)]">
                  {children}
                </span>
              </span>
            </span>
          </>,
          document.body,
        )}
    </span>
  );
}
