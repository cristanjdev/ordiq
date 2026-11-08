"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { infoTipPosition } from "@/lib/info-tip-position";
import { cn } from "@/lib/utils";

interface SelectOption {
  value: string;
  label: string;
}

export function SearchableSelect({
  label,
  value,
  onChange,
  options,
  disabled,
  placeholder = "Select an option",
  searchPlaceholder = "Search…",
  className,
  variant = "default",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  variant?: "default" | "embedded";
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [position, setPosition] = React.useState<ReturnType<typeof infoTipPosition> | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();
  const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const filtered = options.filter((option) =>
    normalize(option.label).includes(normalize(query.trim())),
  );
  const selected = options.find((option) => option.value === value);

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };
  const choose = (option: SelectOption) => {
    onChange(option.value);
    close();
  };
  const show = () => {
    setQuery("");
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setPosition(null);
    setOpen(true);
  };

  React.useLayoutEffect(() => {
    if (!open || disabled) return;
    const boundary = triggerRef.current?.closest("main");
    const update = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      if (!anchor || !panelRef.current) return;
      setPosition(
        infoTipPosition({
          anchor,
          boundary: boundary?.getBoundingClientRect(),
          viewportWidth: window.innerWidth,
          viewportHeight: window.visualViewport?.height ?? window.innerHeight,
          height: Math.min(320, panelRef.current.scrollHeight + 2),
          align: "end",
          mobileSheet: false,
          preferredWidth: Math.max(240, anchor.width),
        }),
      );
    };
    update();
    inputRef.current?.focus({ preventScroll: true });
    const observer = new ResizeObserver(update);
    if (triggerRef.current) observer.observe(triggerRef.current);
    if (panelRef.current) observer.observe(panelRef.current);
    if (boundary) observer.observe(boundary);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    const outside = (event: PointerEvent) => {
      if (
        !triggerRef.current?.contains(event.target as Node) &&
        !panelRef.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [open, disabled]);

  React.useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId, query]);

  const onKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      close();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[active];
      if (option) choose(option);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && filtered.length) {
      event.preventDefault();
      setActive((index) =>
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? filtered.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length,
      );
    }
  };

  return (
    <div className={cn("min-w-0", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open && !disabled}
        aria-controls={open && !disabled ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
          }
        }}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-xs font-medium text-[var(--ordiq-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ordiq-maroon)]/30 disabled:opacity-60",
          variant === "embedded"
            ? "bg-transparent focus-visible:ring-inset"
            : "border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)]",
        )}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[var(--ordiq-muted)] transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open &&
        !disabled &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[70] flex flex-col overflow-hidden rounded-xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] shadow-xl"
            style={{
              left: position?.left ?? 12,
              top: position?.top ?? 12,
              width: position?.width ?? 240,
              maxHeight: position?.maxHeight ?? 320,
              visibility: position ? "visible" : "hidden",
            }}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-[var(--ordiq-border)] px-3 py-2.5">
              <Search className="h-4 w-4 shrink-0 text-[var(--ordiq-muted)]" />
              <input
                ref={inputRef}
                role="combobox"
                aria-label={`Search ${label.toLowerCase()}`}
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
                value={query}
                placeholder={searchPlaceholder}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onKey}
                className="min-w-0 flex-1 bg-transparent text-base text-[var(--ordiq-ink)] outline-none placeholder:text-[var(--ordiq-muted)] sm:text-xs"
              />
            </div>
            <ul
              id={listId}
              role="listbox"
              aria-label={label}
              className="min-h-0 max-h-64 overflow-y-auto overscroll-contain p-1"
            >
              {filtered.map((option, index) => (
                <li
                  key={option.value}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                  onMouseMove={() => setActive(index)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2.5 text-xs text-[var(--ordiq-ink)]",
                    index === active && "bg-[var(--ordiq-surface-muted)]",
                    option.value === value &&
                      "font-semibold text-[var(--ordiq-maroon)] dark:text-[var(--ordiq-orange)]",
                  )}
                >
                  <span className="min-w-0 break-words">{option.label}</span>
                  {option.value === value && <Check className="h-3.5 w-3.5 shrink-0" />}
                </li>
              ))}
            </ul>
            {!filtered.length && (
              <p role="status" className="px-4 py-5 text-center text-xs text-[var(--ordiq-muted)]">
                No matches found.
              </p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
