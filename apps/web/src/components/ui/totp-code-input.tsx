"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TotpCodeInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaDescribedBy?: string;
  className?: string;
}

export const TotpCodeInput = React.forwardRef<HTMLInputElement, TotpCodeInputProps>(
  (
    {
      id = "authCode",
      value,
      onChange,
      disabled = false,
      autoFocus = false,
      ariaDescribedBy,
      className,
    },
    ref,
  ) => {
    const [isFocused, setIsFocused] = React.useState(false);
    const internalInputRef = React.useRef<HTMLInputElement | null>(null);

    // Merge external ref with internal ref so both work for .focus()
    React.useImperativeHandle(ref, () => internalInputRef.current as HTMLInputElement);

    const length = 6;
    const chars = value.split("").slice(0, length);

    const renderBox = (i: number) => {
      const char = chars[i];
      const isCurrent =
        isFocused && (i === chars.length || (i === length - 1 && chars.length === length));
      const isFilled = Boolean(char);

      return (
        <div
          key={i}
          className={cn(
            "relative flex-1 min-w-0 flex h-10 sm:h-10.5 md:h-11 w-full items-center justify-center rounded-lg sm:rounded-xl font-mono text-base sm:text-lg md:text-xl font-bold transition-all duration-150 select-none shadow-2xs",
            isCurrent
              ? "border-2 border-[#5a0e19] dark:border-[#ea580c] bg-white dark:bg-black/40 text-gray-900 dark:text-white ring-3 ring-[#5a0e19]/15 dark:ring-[#ea580c]/20 scale-[1.02]"
              : isFilled
                ? "border border-gray-300 dark:border-white/20 bg-white dark:bg-white/10 text-gray-900 dark:text-white font-extrabold"
                : "border border-gray-200 dark:border-white/10 bg-gray-50/70 dark:bg-white/5 text-gray-300 dark:text-white/20",
            disabled && "opacity-60 cursor-not-allowed",
          )}
        >
          {char ? (
            <span>{char}</span>
          ) : isCurrent ? (
            <span className="pointer-events-none inline-block h-4 sm:h-5 w-0.5 animate-caret-blink bg-[#5a0e19] dark:bg-[#ea580c] rounded-full" />
          ) : (
            <span className="text-[10px] sm:text-xs text-gray-300 dark:text-white/20">•</span>
          )}
        </div>
      );
    };

    return (
      <div
        className={cn(
          "relative flex w-full items-center justify-between gap-2 sm:gap-2.5 py-0.5 sm:py-1",
          className,
        )}
        onClick={() => internalInputRef.current?.focus()}
      >
        {/* Hidden full-width native input backing the 6 boxes for keyboard, mobile autofill, and paste */}
        <input
          ref={internalInputRef}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={length}
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          aria-describedby={ariaDescribedBy}
          aria-label="6-digit authenticator code"
          className="absolute inset-0 h-full w-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
        />

        {/* 6 Responsive Digit Boxes */}
        {Array.from({ length }, (_, i) => (
          <React.Fragment key={i}>
            {renderBox(i)}
          </React.Fragment>
        ))}
      </div>
    );
  },
);

TotpCodeInput.displayName = "TotpCodeInput";
